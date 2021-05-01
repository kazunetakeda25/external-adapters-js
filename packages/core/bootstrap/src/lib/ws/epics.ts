import { Execute } from '@chainlink/types'
import { AnyAction } from 'redux'
import { combineEpics, createEpicMiddleware, Epic } from 'redux-observable'
import { merge, Subject, of, race } from 'rxjs'
import {
  catchError,
  delay,
  endWith,
  filter,
  map,
  mergeMap,
  take,
  takeUntil,
  tap,
  withLatestFrom,
} from 'rxjs/operators'
import { webSocket } from 'rxjs/webSocket'
import WebSocket from 'ws'
import { withCache } from '../cache'
import { logger } from '../external-adapter'
import { getFeedId } from '../metrics/util'
import {
  connect,
  connected,
  connectionError,
  disconnect,
  disconnected,
  subscribe,
  subscribed,
  unsubscribe,
  unsubscribed,
  messageReceived,
  WSConfigPayload,
  WSSubscriptionPayload,
  WSMessagePayload,
  WSErrorPayload,
} from './actions'
import {
  ws_connection_active,
  ws_connection_errors,
  ws_subscription_active,
  ws_subscription_total,
  ws_message_total,
} from './metrics'
import { getSubsId } from './reducer'

// Rxjs deserializer defaults to JSON.parse.
// We need to handle errors from non-parsable messages
const deserializer = (message: any) => {
  try {
    return JSON.parse(message.data)
  } catch (e) {
    logger.debug('WS: Message received with invalid format')
    return message
  }
}

export const connectEpic: Epic<AnyAction, AnyAction, any, any> = (action$, state$) =>
  action$.pipe(
    filter(connect.match),
    map(({ payload }) => ({ payload, connectionKey: payload.config.connectionInfo.key })),
    withLatestFrom(state$),
    filter(([{ connectionKey }, state]) => {
      const isActiveConnection = !!state.ws.connections.active[connectionKey]
      const isConnecting = state.ws.connections.connecting[connectionKey] > 1
      return !isActiveConnection && !isConnecting
    }),
    // on a connect action being dispatched, open a new WS connection if one doesn't exist yet
    mergeMap(([{ connectionKey, payload }]) => {
      const { config, wsHandler } = payload
      const {
        connection: { url, protocol },
      } = wsHandler

      const openObserver = new Subject()
      const closeObserver = new Subject()
      const WebSocketCtor = WebSocket
      const wsSubject = webSocket({
        url,
        protocol, // TODO: Double check this
        deserializer,
        openObserver,
        closeObserver,
        WebSocketCtor: WebSocketCtor as any, // TODO: fix types don't match
      })

      // Stream of WS connected & disconnected events
      const open$ = openObserver.pipe(map(() => connected({ config, wsHandler })))
      const close$ = closeObserver.pipe(map(() => disconnected({ config, wsHandler })))

      // Close the WS connection on disconnect
      const disconnect$ = action$.pipe(
        filter(disconnect.match),
        filter(({ payload }) => payload.config.connectionInfo.key === connectionKey),
        tap(() => wsSubject.closed || wsSubject.complete()),
        filter(() => false), // do not duplicate events
      )

      // Subscription requests
      const subscriptions$ = action$.pipe(filter(subscribe.match))

      // Multiplex subscriptions
      const multiplexSubscriptions$ = subscriptions$.pipe(
        filter(({ payload }) => payload.connectionInfo.key === connectionKey),
        map(({ payload }) => ({ payload, subscriptionKey: getSubsId(payload.subscriptionMsg) })),
        withLatestFrom(state$),
        filter(([{ subscriptionKey }, state]) => {
          const isActiveSubscription = !!state.ws.subscriptions[subscriptionKey]?.active
          return !isActiveSubscription
        }),
        // on a subscribe action being dispatched, open a new WS subscription if one doesn't exist yet
        mergeMap(([{ subscriptionKey, payload }]) =>
          wsSubject
            .multiplex(
              () => payload.subscriptionMsg,
              () => wsHandler.unsubscribe(payload.input),
              (message) => {
                /**
                 * If the error in on the subscription, next requests will try to subscribe
                 * If the error happens during a subscription, and is only eventual, can be ignored
                 * If the error happens during a subscription, and the subscription stop receiving messages, the unresponsiveTimeout will take care of it (unsubs/subs)
                 */
                if (wsHandler.isError(message)) {
                  logger.error('WS: Subscription Error', { wsMessage: message })
                  return false
                }
                return getSubsId(wsHandler.subsFromMessage(message)) === subscriptionKey
              },
            )
            .pipe(
              withLatestFrom(state$),
              mergeMap(([message, state]) => {
                const isActiveSubscription = !!state.ws.subscriptions[subscriptionKey]?.active
                if (!isActiveSubscription) {
                  return of(subscribed(payload), messageReceived({ message, subscriptionKey }))
                }
                return of(messageReceived({ message, subscriptionKey }))
              }),
              takeUntil(
                merge(
                  action$.pipe(
                    filter(unsubscribe.match),
                    filter((a) => getSubsId(a.payload.subscriptionMsg) === subscriptionKey),
                  ),
                  action$.pipe(
                    filter(disconnected.match),
                    filter((a) => a.payload.config.connectionInfo.key === connectionKey),
                  ),
                ),
              ),
              endWith(unsubscribed(payload)),
            ),
        ),
        catchError((e) => {
          logger.error(e)
          return of(
            connectionError({ connectionInfo: { key: connectionKey, url }, message: e.message }),
          )
        }),
      )

      // All received messages
      const message$ = action$.pipe(filter(messageReceived.match))

      // Save all received messages to cache
      const withCache$ = message$.pipe(
        filter((action) => wsHandler.filter(action.payload.message)),
        withLatestFrom(state$),
        mergeMap(async ([action, state]) => {
          try {
            const input = state.ws.subscriptions[action.payload.subscriptionKey]?.input || {}
            if (!input) logger.warn(`WS: Could not find subscription from incoming message`)
            const response = wsHandler.toResponse(action.payload.message)
            if (!response) return action
            const execute: Execute = () => Promise.resolve(response)
            const cache = await withCache(execute)
            const wsResponse = {
              ...input,
              data: { ...input.data, maxAge: -1 }, // Force cache set
              debug: { ws: true },
            }
            await cache(wsResponse)
          } catch (e) {
            logger.error(`WS: Cache error: ${e.message}`)
          }
          return action
        }),
        filter(() => false),
      )

      // Once a request happens, a subscription timeout starts. If no more requests ask for
      // this subscription before the time runs out, it will be unsubscribed
      const unsubscribeOnTimeout$ = subscriptions$.pipe(
        // when a subscription comes in
        // TODO: we need to filter duplicated subscriptions here
        mergeMap(({ payload }) => {
          const subscriptionKey = getSubsId(payload.subscriptionMsg)
          // we look for matching subscriptions of the same type
          // which deactivates the current timer
          const reset$ = subscriptions$.pipe(
            filter(({ payload }) => subscriptionKey === getSubsId(payload.subscriptionMsg)),
            take(1),
          )
          // start the current unsubscription timer
          const timeout$ = of(unsubscribe({ ...payload })).pipe(
            delay(config.subscriptionTTL),
            tap(() => logger.info('WS: unsubscribe (inactive feed)')),
          )
          // if a re-subscription comes in before timeout emits, then we emit nothing
          // else we unsubscribe from the current subscription
          return race(reset$, timeout$).pipe(filter((a) => !subscribe.match(a)))
        }),
      )

      const unsubscribeOnNoResponse$ = message$.pipe(
        withLatestFrom(state$),
        mergeMap(
          ([
            {
              payload: { subscriptionKey },
            },
            state,
          ]) => {
            const input = state.ws.subscriptions[subscriptionKey]?.input || {}
            if (!input) logger.warn(`WS: Could not find subscription from incoming message`)

            const reset$ = message$.pipe(
              filter(({ payload }) => subscriptionKey === payload.subscriptionKey),
              take(1),
            )

            const action = {
              input,
              subscriptionMsg: wsHandler.subscribe(input),
              connectionInfo: { key: connectionKey, url },
            }

            const timeout$ = of(unsubscribe(action), subscribe(action)).pipe(
              delay(config.subscriptionUnresponsiveTTL),
              tap(() => logger.info('WS: unsubscribe -> subscribe (unresponsive channel)')),
            )

            return race(reset$, timeout$).pipe(filter((a) => !messageReceived.match(a)))
          },
        ),
      )

      // Merge all & unsubscribe ws connection when a matching unsubscribe comes in
      const unsubscribe$ = merge(unsubscribeOnTimeout$, unsubscribeOnNoResponse$)
      const ws$ = merge(
        open$,
        close$,
        disconnect$,
        multiplexSubscriptions$,
        unsubscribe$,
        withCache$,
      ).pipe(
        takeUntil(
          action$.pipe(
            // TODO: not seeing unsubscribe events because of this
            filter(disconnected.match),
            filter((a) => a.payload.config.connectionInfo.key === connectionKey),
          ),
        ),
      )

      // Return the new connection stream
      return ws$
    }),
  )

export const metricsEpic: Epic<AnyAction, AnyAction, any, any> = (action$, state$) =>
  action$.pipe(
    withLatestFrom(state$),
    tap(([action, state]) => {
      const connectionLabels = (payload: WSConfigPayload) => ({
        key: payload.config.connectionInfo.key,
        url: payload.wsHandler.connection.url,
      })
      const connectionErrorLabels = (payload: WSErrorPayload) => ({
        key: payload.connectionInfo.key,
        url: payload.connectionInfo.url,
        message: payload.message,
      })
      const subscriptionLabels = (payload: WSSubscriptionPayload) => ({
        connection_key: payload.connectionInfo.key,
        connection_url: payload.connectionInfo.url,
        feed_id: getFeedId({ ...payload.input }),
        subscription_key: getSubsId(payload.subscriptionMsg),
      })
      const messageLabels = (payload: WSMessagePayload) => ({
        feed_id: getFeedId({ ...state.ws.subscriptions[action.payload.subscriptionKey]?.input }),
        subscription_key: payload.subscriptionKey,
      })

      switch (action.type) {
        case connected.type:
          ws_connection_active.labels(connectionLabels(action.payload)).inc()
          logger.info('WS: connected', { payload: action.payload })
          break
        case connectionError.type:
          ws_connection_errors.labels(connectionErrorLabels(action.payload)).inc()
          logger.info('WS: connection_error', { payload: action.payload })
          break
        case disconnected.type:
          ws_connection_active.labels(connectionLabels(action.payload)).dec()
          logger.info('WS: disconnected', { payload: action.payload })
          break
        case subscribed.type:
          ws_subscription_total.labels(subscriptionLabels(action.payload)).inc()
          ws_subscription_active.labels(subscriptionLabels(action.payload)).inc()
          logger.info('WS: subscribed', { payload: action.payload })
          break
        case unsubscribed.type:
          ws_subscription_active.labels(subscriptionLabels(action.payload)).dec()
          logger.info('WS: unsubscribed', { payload: action.payload })
          break
        case messageReceived.type:
          ws_message_total.labels(messageLabels(action.payload)).inc()
          break
      }
    }),
    map(([action]) => action),
    filter(() => false), // do not duplicate events
  )

export const rootEpic = combineEpics(connectEpic, metricsEpic)

export const epicMiddleware = createEpicMiddleware()