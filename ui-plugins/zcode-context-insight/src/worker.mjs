/**
 * Worker owning the read-only database connection and the session cache.
 * stdout is reserved for the MCP protocol, so worker errors go back as structured messages.
 */

import { parentPort, workerData } from 'node:worker_threads'
import { createService } from './service.mjs'

const paths = workerData?.paths
let service = null
let closed = false

function getService() {
  if (service === null) service = createService(paths)
  return service
}

async function handle(method, sessionId, args) {
  const svc = getService()
  switch (method) {
    case 'snapshot':
      return svc.snapshot(sessionId, args)
    case 'history':
      return svc.history(sessionId, args)
    case 'step':
      return svc.step(sessionId, args.step, args)
    case 'group':
      return svc.group(sessionId, args.step, args.cat, args)
    case 'dna':
      return svc.dna(sessionId, args.step, args)
    case 'dnaSeries':
      return svc.dnaSeries(sessionId, args)
    case 'element':
      return svc.element(sessionId, args.step, args.key, args)
    case 'eventDetail':
      return svc.eventDetail(sessionId, args.eventId, args)
    case 'fleet':
      return svc.fleet(sessionId, args)
    case 'fleetMember':
      return svc.fleetMember(sessionId, args.targetId, args)
    case 'insights':
      return svc.insights(args)
    case 'preferencesGet':
      return svc.preferencesGet()
    case 'preferencesSet':
      return svc.preferencesSet(args.patch)
    case 'report':
      return svc.report(sessionId)
    default:
      throw Object.assign(new Error('Unknown read method.'), { code: 'unknown_method' })
  }
}

parentPort?.on('message', async (message) => {
  if (message?.cancel) return
  const { id, method, sessionId, args } = message ?? {}
  try {
    const result = await handle(method, sessionId, args ?? {})
    parentPort.postMessage({ id, result })
  } catch (error) {
    parentPort.postMessage({
      id,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'read_failed',
        message: typeof error?.message === 'string' ? error.message : 'Read failed.',
      },
    })
  }
})

process.on('exit', () => {
  if (!closed) {
    closed = true
    service?.close?.()
  }
})
