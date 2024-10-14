# bugsnag-plugin-cloud-run-functions

A [@bugsnag/js](https://docs.bugsnag.com/platforms/javascript/) plugin for capturing errors in Cloud Run functions (ex
Google Cloud Functions).

## Quickstart

Install and configure [@bugsnag/js](https://docs.bugsnag.com/platforms/javascript/), then install the CloudRunFunctions
plugin using npm or yarn:

```shell
npm install @bugsnag/js bugsnag-plugin-cloud-run-functions
```

```shell
yarn add @bugsnag/js bugsnag-plugin-cloud-run-functions
```

To start Bugsnag with the Cloud Run functions, pass the plugin to `Bugsnag.start`:

```javascript
const Bugsnag = require('@bugsnag/js')
const BugsnagPluginCloudRunFunctions = require('bugsnag-plugin-cloud-run-functions')
const functions = require('@google-cloud/function-framework')

Bugsnag.start({
  apiKey: 'YOUR_API_KEY',
  plugins: [BugsnagPluginCloudRunFunctions],
  otherOptions: value
})
```

Start handling errors in your Cloud Run function by wrapping your handler with Bugsnag handler identical by signature
type.

HTTP function:

```javascript
const bugsnagHandler = Bugsnag.getPlugin('CloudRunFunctions').createHttpHandler()

functions.http('httpFunction', bugsnagHandler((req, res) => {
  throw new Error('oops')
}))
```

(!) Note that the plugin is useless if you have express.js as a handler. Please
use [BugSnag middleware for express.js](https://docs.bugsnag.com/platforms/javascript/express/) instead.

Event-driven (CloudEvent) function:

```javascript
const bugsnagHandler = Bugsnag.getPlugin('CloudRunFunctions').createCloudEventHandler()

functions.cloudEvent('cloudEventFunction', bugsnagHandler((cloudEvent) => {
  throw new Error('oops')
}))

// or

functions.cloudEvent('cloudEventFunction', bugsnagHandler((cloudEvent, callback) => {
  callback(new Error('oops'))
}))
```

## Data capture

The Bugsnag CloudRunFunctions plugin will automatically capture the function request in the "Request" tab for HTTP
function and the function event metadata in the "CloudEvent" tab for Event-driven function on every error.

## Session tracking

A session will be reported automatically each time your Cloud Run function is called. This behavior can be disabled
using the [`autoTrackSessions`](https://docs.bugsnag.com/platforms/javascript/configuration-options/#autotracksessions)
configuration option.

## Configuration

The Bugsnag CloudRunFunctions plugin can be configured by passing following options to `createHandler`.

###### flushTimeoutMs

Bugsnag will wait for events and sessions to be delivered before allowing the Cloud Run function to exit.

This option can be used to control the maximum amount of time to wait before timing out.

By default, Bugsnag will timeout after 2000 milliseconds.

```javascript
const bugsnagHandler = Bugsnag.getPlugin('CloudRunFunctions').createHttpHandler({
  flushTimeoutMs: 5000
})
```

If a timeout does occur, Bugsnag will log a warning and events & sessions may not be delivered.

## License

[The Unlicense](UNLICENSE)
