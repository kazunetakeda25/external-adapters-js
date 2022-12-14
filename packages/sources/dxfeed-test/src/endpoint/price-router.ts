import { RoutingTransport } from '@chainlink/external-adapter-framework/transports/meta'
import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { batchTransport } from './price'
import { SingleNumberResultResponse } from '@chainlink/external-adapter-framework/util'
import { wsTransport } from './price-ws'
import { customSettings } from '../config'
import * as process from 'process'

export const inputParameters = {
  base: {
    aliases: ['from', 'coin', 'market'],
    type: 'string',
    description: 'The symbol of symbols of the currency to query',
    required: true,
  },
} as const

export interface ProviderResponseBody {
  status: string
  Trade: {
    [key: string]: {
      eventSymbol: string
      eventTime: number
      time: number
      timeNanoPart: number
      sequence: number
      exchangeCode: string
      price: number
      change: number
      size: number
      dayVolume: number
      dayTurnover: number
      tickDirection: string
      extendedTradingHours: boolean
    }
  }
  Quote: {
    [key: string]: {
      eventSymbol: string
      eventTime: number
      timeNanoPart: number
      bidTime: number
      bidExchangeCode: string
      bidPrice: number
      bidSize: number
      askTime: number
      askExchangeCode: string
      askPrice: number
      askSize: number
      sequence: number
    }
  }
}

export interface RequestParams {
  base: string
}

export interface ProviderRequestBody {
  events: string
  symbols: string
}

export type EndpointTypes = {
  Request: {
    Params: RequestParams
  }
  Response: SingleNumberResultResponse
  CustomSettings: typeof customSettings
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

export const routingTransport = new RoutingTransport<EndpointTypes>(
  {
    WS: wsTransport,
    REST: batchTransport,
  },
  (_, adapterConfig) => {
    if ((adapterConfig && adapterConfig.WS_ENABLED) || process.env['WS_ENABLED'] === 'true') {
      return 'WS'
    }
    return 'REST'
  },
)

export const endpoint = new AdapterEndpoint<EndpointTypes>({
  name: 'price-ws',
  aliases: ['crypto', 'stock', 'forex', 'commodities'],
  transport: routingTransport,
  inputParameters: inputParameters,
})
