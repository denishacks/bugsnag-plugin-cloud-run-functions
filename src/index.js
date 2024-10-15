const BugsnagInFlightPlugin = require('@bugsnag/in-flight')
const BugsnagPluginBrowserSession = require('@bugsnag/plugin-browser-session')
const extractRequestInfo = require('./request-info')

const PLUGIN_NAME = 'cloud run functions plugin'
const FLUSH_TIMEOUT_MS = 2000
const SERVER_PLUGIN_NAMES = ['express', 'koa', 'restify']

const isServerPluginLoaded = client => SERVER_PLUGIN_NAMES.some(name => client.getPlugin(name))

const BugsnagPluginCloudRunFunctions = {
  name: 'CloudRunFunctions',
  load (client) {
    BugsnagInFlightPlugin.trackInFlight(client)
    client._loadPlugin(BugsnagPluginBrowserSession)

    // Reset the app duration between invocations, if the plugin is loaded
    const appDurationPlugin = client.getPlugin('appDuration')

    if (appDurationPlugin) {
      appDurationPlugin.reset()
    }

    return {
      createHttpHandler ({ flushTimeoutMs = FLUSH_TIMEOUT_MS } = {}) {
        return wrapHttpHandler.bind(null, client, flushTimeoutMs)
      },
      createCloudEventHandler ({ flushTimeoutMs = FLUSH_TIMEOUT_MS } = {}) {
        return wrapCloudEventHandler.bind(null, client, flushTimeoutMs)
      },
    }
  },
}

function wrapHttpHandler (client, flushTimeoutMs, handler) {
  return function (req, res) {
    client.addMetadata('request', getRequestInfo(req))

    const _handler = async (req, res) => {
      await handler(req, res)
      await waitForStreamComplete(res)
    }

    return execute.call(null, client, flushTimeoutMs, _handler, req, res)
  }
}

function wrapCloudEventHandler (client, flushTimeoutMs, handler) {
  let _handler = handler

  if (handler.length > 1) {
    // This is a handler expecting a 'callback' argument, so we convert
    // it to return a Promise so '_handler' always has the same API
    _handler = promisifyHandler(handler)
  }

  return function (cloudEvent) {
    client.addMetadata('cloudevent', cloudEvent)

    return execute.call(null, client, flushTimeoutMs, _handler, cloudEvent)
  }
}

async function execute (client, flushTimeoutMs, handler, ..._arguments) {
  // track sessions if autoTrackSessions is enabled and no server plugin is
  // loaded - the server plugins handle starting sessions automatically, so
  // we don't need to start one as well
  if (client._config.autoTrackSessions && !isServerPluginLoaded(client)) {
    client.startSession()
  }

  try {
    return await handler(..._arguments)
  } catch (err) {
    if (client._config.autoDetectErrors && client._config.enabledErrorTypes.unhandledExceptions) {
      const handledState = {
        severity: 'error',
        unhandled: true,
        severityReason: { type: 'unhandledException' },
      }

      const event = client.Event.create(err, true, handledState, PLUGIN_NAME, 1)

      client._notify(event)
    }

    throw err
  } finally {
    try {
      await BugsnagInFlightPlugin.flush(flushTimeoutMs)
    } catch (err) {
      client._logger.error(`Delivery may be unsuccessful: ${err.message}`)
    }
  }
}

function getRequestInfo (req) {
  const requestInfo = extractRequestInfo(req)
  // by default there is empty "0" parameter, so unset it
  if (typeof requestInfo.params === 'object' && 0 in requestInfo.params) {
    delete requestInfo.params[0]

    if (Object.keys(requestInfo.params).length === 0) {
      requestInfo.params = undefined
    }
  }

  return requestInfo
}

function waitForStreamComplete (stream) {
  if (stream.writableEnded) {
    return stream
  }

  return new Promise((resolve, reject) => {
    stream.once('error', complete)
    stream.once('end', complete)
    stream.once('finish', complete)

    let isComplete = false

    function complete (err) {
      if (isComplete) {
        return
      }

      isComplete = true

      stream.removeListener('error', complete)
      stream.removeListener('end', complete)
      stream.removeListener('finish', complete)

      if (err) {
        reject(err)
      } else {
        resolve(stream)
      }
    }
  })
}

// Convert a handler that uses callbacks to an async handler
function promisifyHandler (handler) {
  return function (cloudEvent) {
    return new Promise(function (resolve, reject) {
      const result = handler(cloudEvent, function (err, response) {
        err
          ? reject(err)
          : resolve(response)
      })

      // Handle an edge case where the passed handler has the callback parameter
      // but actually returns a promise. In this case we need to resolve/reject
      // based on the returned promise instead of in the callback
      if (isPromise(result)) {
        result.then(resolve).catch(reject)
      }
    })
  }
}

function isPromise (value) {
  return (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function' &&
    typeof value.catch === 'function'
}

module.exports = BugsnagPluginCloudRunFunctions

// add a default export for ESM modules without interop
module.exports.default = module.exports
