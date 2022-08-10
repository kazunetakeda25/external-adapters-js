import { DEFAULT_DELTA_TIME } from '../../src/config'
import { useFakeTimers } from 'sinon'
import * as network from '../../src/network'
import { makeExecute } from '../../src/adapter'
import { TInputParameters } from '../../src/endpoint'
import { AdapterRequest, AxiosResponse, Requester } from '@chainlink/ea-bootstrap'
import { getMockAxiosResponse } from './helpers'

describe('adapter', () => {
  describe('Adapter health check', () => {
    const execute = makeExecute()
    let clock: any
    beforeEach(() => {
      clock = useFakeTimers()
      jest.spyOn(network, 'getStatusByTransaction').mockReturnValue(Promise.resolve(false))
    })

    afterEach(() => {
      clock.restore()
    })

    it('If direct sequencer check fails, the network is unhealthy', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(false))

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(1)
    })

    it('If direct sequencer check throws, the network is unhealthy', async () => {
      jest
        .spyOn(network, 'getSequencerHealth')
        .mockReturnValue(Promise.reject(new Error('Endpoint is not available')))

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(1)
    })

    it('If direct sequencer check succeeds and L2 network check succeeds, the network is healthy', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(true))
      jest.spyOn(Requester, 'request').mockReturnValue(
        Promise<AxiosResponse>.resolve(
          getMockAxiosResponse({
            data: {
              result: '0x1',
            },
          }),
        ),
      )

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(0)
    })

    it('If direct sequencer check succeeds and L2 network check fails, the network is unhealthy', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(true))
      jest.spyOn(Requester, 'request').mockReturnValue(
        Promise<AxiosResponse>.resolve(
          getMockAxiosResponse({
            data: {
              result: '0x1',
            },
          }),
        ),
      )

      await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      clock.tick(DEFAULT_DELTA_TIME + 1)

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(1)
    })

    it('If direct sequencer check succeeds and L2 network check throws, the network is unhealthy', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(true))
      jest.spyOn(network, 'retry').mockRejectedValue(new Error('Some RPC call error'))

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(1)
    })

    it('Empty transaction check has the final word on unhealthy method responses', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(false))
      jest.spyOn(network, 'getStatusByTransaction').mockReturnValue(Promise.resolve(true))
      jest.spyOn(Requester, 'request').mockRejectedValue(new Error('Some RPC call error'))

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(0)
    })

    it('Empty transaction confirms rest of methods', async () => {
      jest.spyOn(network, 'getSequencerHealth').mockReturnValue(Promise.resolve(false))
      jest.spyOn(network, 'getStatusByTransaction').mockReturnValue(Promise.resolve(false))

      const response = await execute(
        {
          data: {
            network: 'arbitrum',
          },
        } as AdapterRequest<TInputParameters>,
        {},
      )

      expect(response.data.result).toBe(1)
    })
  })

  describe('Adapter build', () => {
    it('Cache enabled throws when building the adapter', async () => {
      process.env.CACHE_ENABLED = 'true'
      const execute = makeExecute()
      await expect(
        execute(
          {
            id: '',
            data: {},
          } as AdapterRequest<TInputParameters>,
          {},
        ),
      ).rejects.toThrow()
    })
  })
})
