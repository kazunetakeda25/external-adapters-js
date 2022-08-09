import { AdapterRequest } from '@chainlink/ea-bootstrap'
import process from 'process'
import { server as startServer } from '../../src'
import { mockEthereumResponseSuccess } from './fixtures'
import { setupExternalAdapterTest } from '@chainlink/ea-test-helpers'
import type { SuiteContext } from '@chainlink/ea-test-helpers'
import { SuperTest, Test } from 'supertest'

describe('execute', () => {
  const id = '1'
  const context: SuiteContext = {
    req: null,
    server: startServer,
  }

  const envVariables = {
    ETHEREUM_RPC_URL: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545',
    API_VERBOSE: 'true',
  }

  setupExternalAdapterTest(envVariables, context)

  describe('with from/to', () => {
    const data: AdapterRequest = {
      id,
      data: {
        from: 'USDC',
        to: 'USDT',
      },
    }

    it('should return success', async () => {
      mockEthereumResponseSuccess()

      const response = await (context.req as SuperTest<Test>)
        .post('/')
        .send(data)
        .set('Accept', '*/*')
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response.body).toMatchSnapshot()
    })
  })

  describe('with custom params', () => {
    const data: AdapterRequest = {
      id,
      data: {
        from: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        fromDecimals: 18,
        to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        toDecimals: 18,
        amount: 10,
      },
    }

    it('should return success', async () => {
      mockEthereumResponseSuccess()

      const response = await (context.req as SuperTest<Test>)
        .post('/')
        .send(data)
        .set('Accept', '*/*')
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response.body).toMatchSnapshot()
    })
  })
})
