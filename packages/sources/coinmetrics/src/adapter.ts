import { Builder, Requester, Validator, Logger, AdapterInputError } from '@chainlink/ea-bootstrap'
import {
  Config,
  ExecuteWithConfig,
  ExecuteFactory,
  MakeWSHandler,
  AdapterRequest,
  APIEndpoint,
} from '@chainlink/ea-bootstrap'
import { makeConfig } from './config'
import * as endpoints from './endpoint'

export const execute: ExecuteWithConfig<Config, endpoints.TInputParameters> = async (
  request,
  context,
  config,
) => {
  return Builder.buildSelector<Config, endpoints.TInputParameters>(
    request,
    context,
    config,
    endpoints,
  )
}

export const endpointSelector = (
  request: AdapterRequest,
): APIEndpoint<Config, endpoints.TInputParameters> =>
  Builder.selectEndpoint<Config, endpoints.TInputParameters>(request, makeConfig(), endpoints)

export const makeExecute: ExecuteFactory<Config, endpoints.TInputParameters> = (config) => {
  return async (request, context) => execute(request, context, config || makeConfig())
}

export interface WebsocketResponseSchema {
  time: string
  asset: string
  ReferenceRateUSD?: string
  ReferenceRateEUR?: string
  cm_sequence_id: string
}

const VALID_REFERENCE_RATE_QUOTES = ['USD', 'EUR', 'ETH', 'BTC']

const getSubKeyInfo = (input: AdapterRequest) => {
  const validator = new Validator(input, endpoints.price.inputParameters)
  const asset = validator.validated.data.base.toLowerCase()
  const quote = validator.validated.data.quote.toUpperCase()
  if (!VALID_REFERENCE_RATE_QUOTES.includes(quote))
    throw new AdapterInputError({
      jobRunID: input.id,
      statusCode: 400,
      message: `Quote must be one of ${VALID_REFERENCE_RATE_QUOTES}`,
    })
  const metrics = `ReferenceRate${quote}`
  return { asset, metrics }
}

export interface WSError {
  error: {
    type: string
    message: string
  }
}

export const BAD_PARAMETERS = 'bad_parameters'
export const BAD_PARAMETER = 'bad_parameter'

export const makeWSHandler = (config?: Config): MakeWSHandler => {
  return () => {
    const defaultConfig = config || makeConfig()
    return {
      connection: {
        url: defaultConfig.ws?.baseWsURL,
      },
      subscribe: (input) => {
        const { asset, metrics } = getSubKeyInfo(input)
        return `${asset}${metrics}`
      },
      unsubscribe: () => '',
      subsFromMessage: (message: any) => {
        const metrics = Object.keys(message).find((key) => key.includes('ReferenceRate'))
        if (!metrics)
          Logger.debug(`Error: Could not find "ReferenceRate" key in WS message. ${message}`)
        return `${message.asset}${metrics}`
      },
      isError: (message: any) => !!message.error,
      filter: () => true,
      toResponse: (message: any, input) => {
        const { metrics } = getSubKeyInfo(input)
        const result = Requester.validateResultNumber(message, [metrics])
        return Requester.success('1', { data: { result } })
      },
      programmaticConnectionInfo: (input) => {
        const { asset, metrics } = getSubKeyInfo(input)
        const key = `${asset}${metrics}`
        const url = `${defaultConfig.ws?.baseWsURL}/timeseries-stream/asset-metrics?assets=${asset}&metrics=${metrics}&frequency=1s&api_key=${defaultConfig.apiKey}`
        return {
          key,
          url,
        }
      },
      shouldNotRetryConnection: (error) => {
        const wsError = error as WSError
        return wsError.error.type === BAD_PARAMETERS || wsError.error.type === BAD_PARAMETER
      },
    }
  }
}
