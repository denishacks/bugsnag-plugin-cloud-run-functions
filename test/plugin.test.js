const BugsnagPluginCloudRunFunction = require('../src')
const Client = require('@bugsnag/core/client')
const { expect } = require('chai')
const functions = require('@google-cloud/functions-framework')
const { getTestServer } = require('@google-cloud/functions-framework/testing')
const request = require('supertest')
const sinon = require('sinon')
const util = require('node:util')

const cloudEvent = {
  'id': '4df34f10-6ede-468d-9515-4ddd5ee26d56',
  'time': '2024-10-14T10:13:10.178Z',
  'type': 'com.github.pull.create',
  'source': '/cloudevents/spec/pull',
  'specversion': '1.0',
  'datacontenttype': 'application/json',
  'data': { 'key': 'value' },
}

const createClient = (events, sessions, config = {}) => {
  const client = new Client({
    apiKey: 'AN_API_KEY',
    plugins: [BugsnagPluginCloudRunFunction],
    ...config,
  })

  client.Event.__type = 'nodejs'

  // a flush failure won't throw as we don't want to crash apps if delivery takes
  // too long. To avoid the unit tests passing when this happens, we make the logger
  // throw on any 'error' log call
  client._logger.error = (...args) => { throw new Error(util.format(args)) }

  client._delivery = {
    sendEvent (payload, cb = () => {}) {
      events.push(payload)
      cb()
    },
    sendSession (payload, cb = () => {}) {
      sessions.push(payload)
      cb()
    },
  }

  return client
}

describe('plugin: cloud run functions', () => {
  it('has a name', () => {
    expect(BugsnagPluginCloudRunFunction.name).eq('CloudRunFunctions')
  })

  it('exports a handlers functions', () => {
    const client = new Client({
      apiKey: 'AN_API_KEY',
      plugins: [BugsnagPluginCloudRunFunction],
    })
    const plugin = client.getPlugin('CloudRunFunctions')

    expect(plugin).to.be.a('object')
    expect(plugin.createHttpHandler).to.be.a('function')
    expect(plugin.createCloudEventHandler()).to.be.a('function')
  })

  describe('http handler', () => {
    it('adds the request as metadata', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = (req, res) => { res.send('abc') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).get('/').then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        const metadata = client.getMetadata('request')

        expect(metadata).to.be.a('object')

        expect(metadata.url).to.be.a('string')
        expect(metadata.path).to.be.a('string')
        expect(metadata.httpMethod).to.be.a('string')
        expect(metadata.headers).to.be.a('object')
        expect(metadata.httpVersion).to.be.a('string')
        expect(metadata.params).eq(undefined)
        expect(metadata.query).eq(undefined)
        expect(metadata.body).eq(undefined)
        expect(metadata.clientIp).to.be.a('string')
        expect(metadata.referer).eq(undefined)
        expect(metadata.connection).to.be.a('object')

        done()
      }).catch(done)
    })

    it('logs an error if flush times out', (done) => {
      const client = createClient([], [])
      client._logger.error = sinon.fake()

      client._delivery = {
        sendEvent (payload, cb = () => {}) {
          setTimeout(cb, 250)
        },
        sendSession (payload, cb = () => {}) {
          setTimeout(cb, 250)
        },
      }

      const handler = (req, res) => {
        client.notify('hello')

        res.send('abc')
      }

      const timeoutError = new Error('flush timed out after 20ms')

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler({ flushTimeoutMs: 20 })
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).get('/').then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        setTimeout(() => {
          try {
            expect(client._logger.error.calledWith(`Delivery may be unsuccessful: ${timeoutError.message}`)).true

            done()
          } catch (err) {
            done(err)
          }

        }, 250)
      }).catch(done)
    })

    it('resolves to the value passed to the response', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = (req, res) => { res.send('abc') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).get('/').then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('notifies when an error is thrown', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const error = new Error('oh no')
      const handler = (req, res) => { throw error }

      expect(handler).throws('oh no')

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).get('/').then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(error.message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "autoDetectErrors" is false', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { autoDetectErrors: false })

      const error = new Error('oh no')
      const handler = (req, res) => { throw error }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).get('/').then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "unhandledExceptions" are disabled', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { enabledErrorTypes: { unhandledExceptions: false } })

      const error = new Error('oh no')
      const handler = (req, res) => { throw error }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).get('/').then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('will track sessions when "autoTrackSessions" is enabled', (done) => {
      const events = []
      const sessions = []
      const client = createClient(events, sessions, { autoTrackSessions: true })

      const handler = (req, res) => { res.send('abc') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).get('/').then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('will not track sessions when "autoTrackSessions" is disabled', (done) => {
      const events = []
      const sessions = []
      const client = createClient(events, sessions, { autoTrackSessions: false })

      const handler = (req, res) => { res.send('abc') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createHttpHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.http('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).get('/').then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(0)

        done()
      }).catch(done)
    })
  })

  describe('event-driven handler (cloudevent)', () => {
    it('adds the cloudevent as metadata', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = (cloudEvent) => 'abc'

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.text).eq('abc')

        expect(client.getMetadata('cloudevent')).to.deep.eq(cloudEvent)

        done()
      }).catch(done)
    })

    it('logs an error if flush times out', (done) => {
      const client = createClient([], [])
      client._logger.error = sinon.fake()

      client._delivery = {
        sendEvent (payload, cb = () => {}) {
          setTimeout(cb, 250)
        },
        sendSession (payload, cb = () => {}) {
          setTimeout(cb, 250)
        },
      }

      const handler = (cloudEvent) => {
        client.notify('hello')

        return 'abc'
      }

      const timeoutError = new Error('flush timed out after 20ms')

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler({ flushTimeoutMs: 20 })
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.text).eq('abc')

        expect(client._logger.error.calledWith(`Delivery may be unsuccessful: ${timeoutError.message}`)).true

        done()
      }).catch(done)
    })

    it('resolves to the original return value (async)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = (cloudEvent) => 'abc'

      expect(handler()).eq('abc')

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('notifies when an error is thrown (async)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const error = new Error('oh no')
      const handler = (cloudEvent) => { throw error }

      expect(handler).throws('oh no')

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      expect(events).length(0)
      expect(sessions).length(0)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(error.message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "autoDetectErrors" is false (async)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { autoDetectErrors: false })

      const error = new Error('oh no')
      const handler = (cloudEvent) => { throw error }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "unhandledExceptions" are disabled (async)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { enabledErrorTypes: { unhandledExceptions: false } })

      const error = new Error('oh no')
      const handler = (cloudEvent) => { throw error }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('oh no')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('resolves to the value passed to the callback (callback)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = (cloudEvent, callback) => { callback(null, 'xyz') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('xyz')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('notifies when an error is passed (callback)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const error = new Error('uh oh')
      const handler = (cloudEvent, callback) => { callback(error) }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('uh oh')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(error.message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "autoDetectErrors" is false (callback)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { autoDetectErrors: false })

      const error = new Error('uh oh')
      const handler = (cloudEvent, callback) => { callback(error) }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('uh oh')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('does not notify when "unhandledExceptions" are disabled (callback)', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { enabledErrorTypes: { unhandledExceptions: false } })

      const error = new Error('uh oh')
      const handler = (cloudEvent, callback) => { callback(error) }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('uh oh')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('works when an async handler has the callback parameter', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = async (cloudEvent, callback) => 'abcxyz'

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abcxyz')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('works when an async handler has the callback parameter and calls it', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const handler = async (cloudEvent, callback) => { callback(null, 'abcxyz') }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abcxyz')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('works when an async handler has the callback parameter and throws', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const error = new Error('abcxyz')
      const handler = async (event, context, callback) => { throw error }

      handler().catch(err => expect(err).eq('abcxyz'))

      const event = { very: 'eventy' }
      const context = { extremely: 'contextual' }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('abcxyz')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(error.message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('works when an async handler has the callback parameter and calls it with an error', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const error = new Error('abcxyz')
      const handler = async (cloudEvent, callback) => { callback(error) }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('abcxyz')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(error.message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('will track sessions when "autoTrackSessions" is enabled', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions, { autoTrackSessions: true })

      const handler = (eventCloud) => 'abc'

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })

    it('will not track sessions when "autoTrackSessions" is disabled', (done) => {
      const events = []
      const sessions = []
      const client = createClient(events, sessions, { autoTrackSessions: false })

      const handler = () => 'abc'

      const event = { very: 'eventy' }
      const context = { extremely: 'contextual' }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(200)
        expect(res.text).eq('abc')

        expect(events).length(0)
        expect(sessions).length(0)

        done()
      }).catch(done)
    })

    it('supports a string as the error argument in a callback', (done) => {
      const events = []
      const sessions = []

      const client = createClient(events, sessions)

      const message = 'uh oh'
      const handler = (cloudEvent, callback) => { callback(message) }

      const plugin = client.getPlugin('CloudRunFunctions')

      if (!plugin) {
        throw new Error('Plugin was not loaded!')
      }

      const bugsnagHandler = plugin.createCloudEventHandler()
      const wrappedHandler = bugsnagHandler(handler)

      functions.cloudEvent('fn', wrappedHandler)
      const app = getTestServer('fn')

      expect(events).length(0)
      expect(sessions).length(0)

      request(app).post('/').send(cloudEvent).then(res => {
        expect(res.status).eq(500)
        expect(res.text).eq('uh oh')

        expect(events).length(1)
        expect(events[0].events[0].errors[0].errorMessage).eq(message)
        expect(sessions).length(1)

        done()
      }).catch(done)
    })
  })
})
