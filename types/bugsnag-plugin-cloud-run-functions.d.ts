import { Plugin, Client } from '@bugsnag/core'

declare const BugsnagPluginCloudRunFunctions: Plugin
export default BugsnagPluginCloudRunFunctions

type HttpFunction = (req: any, res: any) => Promise<any>
type ExpressApplication = (req: any, res: any, next) => any
type CallbackFunction = (err?: Error | string | null, response?: any) => void
type CloudEventFunction = (cloudEvent: any) => Promise<any>
type CloudEventFunctionWithCallback = (cloudEvent: any, callback: CallbackFunction) => void

export type BugsnagPluginCloudRunFunctionsHttpHandler = (handler: HttpFunction | ExpressApplication) => HttpFunction
export type BugsnagPluginCloudRunFunctionsCloudEventHandler = (handler: CloudEventFunction | CloudEventFunctionWithCallback) => CloudEventFunction

export interface BugsnagPluginCloudRunFunctionsConfiguration {
  flushTimeoutMs?: number
}

export interface BugsnagPluginCloudRunFunctionsResult {
  createHttpHandler (configuration?: BugsnagPluginCloudRunFunctionsConfiguration): BugsnagPluginCloudRunFunctionsHttpHandler
  createCloudEventHandler (configuration?: BugsnagPluginCloudRunFunctionsConfiguration): BugsnagPluginCloudRunFunctionsCloudEventHandler
}

// add a new call signature for the getPlugin() method that types the plugin result
declare module '@bugsnag/core' {
  interface Client {
    getPlugin (id: 'CloudRunFunctions'): BugsnagPluginCloudRunFunctionsResult | undefined
  }
}
