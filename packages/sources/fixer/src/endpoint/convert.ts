import { Requester, Validator } from '@chainlink/ea-bootstrap'
import { ExecuteWithConfig, Config, InputParameters } from '@chainlink/types'
import { NAME as AdapterName } from '../config'

export const supportedEndpoints = ['convert', 'price']

const customError = (data: any) => data.Response === 'Error'

export const inputParameters: InputParameters = {
  base: ['base', 'from', 'coin'],
  quote: ['quote', 'to', 'market'],
  amount: false,
}

interface ResponseSchema {
  success: boolean
  query: { from: string; to: string; amount: number }
  info: { timestamp: number; rate: number }
  date: string
  result: number
}

export const execute: ExecuteWithConfig<Config> = async (request, _, config) => {
  const validator = new Validator(request, inputParameters)
  if (validator.error) throw validator.error

  const jobRunID = validator.validated.id
  const url = `/api/convert`
  const from = (validator.overrideSymbol(AdapterName) as string).toUpperCase()
  const to = validator.validated.data.quote.toUpperCase()
  const amount = validator.validated.data.amount || 1

  const params = {
    ...config.api.params,
    from,
    to,
    amount,
  }

  const options = {
    ...config.api,
    url,
    params,
  }

  const response = await Requester.request<ResponseSchema>(options, customError)
  const result = Requester.validateResultNumber(response.data, ['result'])

  return Requester.success(jobRunID, Requester.withResult(response, result), config.verbose)
}
