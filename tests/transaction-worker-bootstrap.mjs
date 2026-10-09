// Keep the native entry point alive while tsx's asynchronous module graph and
// Payload initialise. An unresolved promise alone does not keep Node running.
// One attempt, a bounded deadline and a required result; never hide a failure
// by rerunning the worker until a favourable scheduling result appears.
import { pathToFileURL } from 'node:url'
const keepalive = setInterval(() => {}, 250)
const deadline = setTimeout(() => {
  console.error('Isolated synthetic checkout worker exceeded its 60-second deadline.')
  process.exit(1)
}, 60_000)
try {
  await import('payload')
  await import(pathToFileURL(process.argv[2]).href)
} catch (error) {
  console.error(JSON.stringify({ workerInitializationError: error instanceof Error ? error.name : 'UnknownError' }))
  process.exitCode = 1
} finally {
  deadline.unref()
  clearInterval(keepalive)
}
