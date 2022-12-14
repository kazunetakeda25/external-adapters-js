import { WebSocketTransport } from '@chainlink/external-adapter-framework/transports/websocket'
import { makeLogger, SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { WebSocket } from '@chainlink/external-adapter-framework/transports'
import { customSettings } from '../config'

const logger = makeLogger('DxFeed Websocket')

export type DXFeedMessage = {
  channel: string
  clientId?: string
  id: string
  data: [string, [string, number, number, number, number, string, number, string, number, number]]
  successful?: boolean
  advice?: {
    interval: number
    timeout: number
    reconnect: string
  }
}[]

export type EndpointTypes = {
  Request: {
    Params: { base: string }
  }
  Response: SingleNumberResultResponse
  CustomSettings: typeof customSettings
  Provider: {
    WsMessage: DXFeedMessage
  }
}

const META_HANDSHAKE = '/meta/handshake'
const META_CONNECT = '/meta/connect'
const SERVICE_SUB = '/service/sub'
const SERVICE_DATA = '/service/data'

const handshakeMsg = [
  {
    id: 1,
    version: '1.0',
    minimumVersion: '1.0',
    channel: META_HANDSHAKE,
    supportedConnectionTypes: ['websocket', 'long-polling', 'callback-polling'],
    advice: {
      timeout: 60000,
      interval: 0,
    },
  },
]

const firstHeartbeatMsg = [
  {
    id: 2,
    channel: META_CONNECT,
    connectionType: 'websocket',
    clientId: '',
    advice: {
      timeout: 60000,
    },
  },
]

const heartbeatMsg = [
  {
    id: 3,
    channel: META_CONNECT,
    clientId: '',
    connectionType: 'websocket',
  },
]

class DxFeedWebsocketTransport extends WebSocketTransport<EndpointTypes> {
  connectionClientId = ''
}

export const wsTransport: DxFeedWebsocketTransport = new DxFeedWebsocketTransport({
  url: (context) => context.adapterConfig.WS_API_ENDPOINT,
  handlers: {
    open(connection) {
      return new Promise((resolve) => {
        connection.on('message', (data: WebSocket.MessageEvent) => {
          const message: DXFeedMessage[0] = JSON.parse(data.toString())[0]
          if (message.clientId && message.channel === '/meta/handshake') {
            wsTransport.connectionClientId = message.clientId
            firstHeartbeatMsg[0].clientId = message.clientId
            connection.send(JSON.stringify(firstHeartbeatMsg))
          }

          if (message.channel === '/meta/connect') {
            heartbeatMsg[0].clientId = wsTransport.connectionClientId
            heartbeatMsg[0].id = parseInt(message.id) + 1
            connection.send(JSON.stringify(heartbeatMsg))
            resolve()
          }
        })
        connection.send(JSON.stringify(handshakeMsg))
      })
    },
    message(message) {
      //If dxfeed errors there is no information about failed feeds/params in the message, returning empty array
      if (message[0].successful === false) {
        logger.warn('Dxfeed returned unsuccessful message')
        return []
      }

      if (Array.isArray(message) && message[0].channel === SERVICE_DATA) {
        const base = message[0].data[1][0]
        const price = message[0].data[1][6]
        console.log('returned to be saved in cache', base, price)
        return [
          {
            params: { base },
            response: {
              result: price,
              data: {
                result: price,
              },
            },
          },
        ]
      } else {
        return []
      }
    },
  },
  builders: {
    subscribeMessage: (params) => {
      return [
        {
          channel: SERVICE_SUB,
          data: { add: { Quote: [params.base.toUpperCase()] } },
          clientId: `${wsTransport.connectionClientId}`,
        },
      ]
    },
    unsubscribeMessage: (params) => {
      return [
        {
          channel: SERVICE_SUB,
          data: { remove: { Quote: [params.base.toUpperCase()] } },
          clientId: `${wsTransport.connectionClientId}`,
        },
      ]
    },
  },
})
