import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { SettingsMap } from '@chainlink/external-adapter-framework/config'
import { RestTransport } from '@chainlink/external-adapter-framework/transports'
import { InputParameters } from '@chainlink/external-adapter-framework/validation'
import { DEFAULT_API_ENDPOINT, PRO_API_ENDPOINT } from '../config'
import { buildUrlPath } from '../crypto-utils'

export const inputParameters: InputParameters = {
  base: {
    aliases: ['from', 'coin'],
    type: 'string',
    required: true,
  },
  hours: {
    description: 'Number of hours to get VWAP for',
    type: 'number',
    default: 24,
  },
  coinid: {
    description: 'The coin ID (optional to use in place of `base`)',
    required: false,
    type: 'string',
  },
}

interface Response {
  timestamp: string
  price: number
  volume_24h: number
  market_cap: number
}

export interface RequestParams {
  coinid?: string
  base?: string
  hours: number
}

export interface RequestBody {
  start: string
  interval: number
}

type EndpointTypes = {
  Request: {
    Params: RequestParams
  }
  Response: {
    Data: {
      result: number
    }
    Result: number
  }
  CustomSettings: SettingsMap
  Provider: {
    RequestBody: RequestBody
    ResponseBody: Response[]
  }
}

const formatUtcDate = (date: Date) => date.toISOString().split('T')[0]

const restEndpointTransport = new RestTransport<EndpointTypes>({
  prepareRequest: (req, config) => {
    const coin = req.requestContext.data.coinid ?? req.requestContext.data.base
    const url = buildUrlPath('v1/tickers/:coin/historical', { coin: coin?.toLowerCase() })

    const baseURL = config.API_KEY ? PRO_API_ENDPOINT : DEFAULT_API_ENDPOINT
    const headers: { Authorization?: string } = {}
    if (config.API_KEY) {
      headers['Authorization'] = config.API_KEY
    }

    const endDate = new Date()
    const subMs = req.requestContext.data.hours * 60 * 60 * 1000
    const startDate = new Date(endDate.getTime() - subMs)

    const params = {
      start: formatUtcDate(startDate),
      interval: `${req.requestContext.data.hours}h`,
    }

    return {
      baseURL,
      url,
      method: 'GET',
      params,
      headers,
    }
  },
  parseResponse: (_, res) => {
    return {
      data: {
        result: res.data[0].price,
      },
      statusCode: 200,
      result: res.data[0].price,
    }
  },
  options: {
    requestCoalescing: {
      enabled: true,
    },
  },
})

export const endpoint = new AdapterEndpoint<EndpointTypes>({
  name: 'vwap',
  aliases: ['crypto-vwap'],
  transport: restEndpointTransport,
  inputParameters,
})
