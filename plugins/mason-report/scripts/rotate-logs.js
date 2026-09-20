'use strict'

const fs = require('fs')
const path = require('path')

const { debugLog } = require('./utils')

/**
 * Rotate a single event file once it grows past maxFileBytes, and cap the
 * total number of event files kept in the events directory (oldest first).
 * Never throws; all failures are logged and skipped.
 *
 * @param {string} eventsDir
 * @param {string} currentFile - the file just appended to
 * @param {{maxFileBytes: number, maxFiles: number}} limits
 */
function rotateIfNeeded(eventsDir, currentFile, limits) {
  const { maxFileBytes, maxFiles } = limits

  try {
    if (fs.existsSync(currentFile)) {
      const stat = fs.statSync(currentFile)
      if (stat.size > maxFileBytes) {
        const rotatedName = currentFile.replace(/\.jsonl$/, '') + `.${Date.now()}.rotated.jsonl`
        fs.renameSync(currentFile, rotatedName)
        debugLog(`rotated ${path.basename(currentFile)} -> ${path.basename(rotatedName)} (exceeded ${maxFileBytes} bytes)`)
      }
    }
  } catch (err) {
    debugLog(`rotation (size check) failed: ${err && err.message}`)
  }

  try {
    enforceFileCountCap(eventsDir, maxFiles)
  } catch (err) {
    debugLog(`rotation (count cap) failed: ${err && err.message}`)
  }
}

function enforceFileCountCap(eventsDir, maxFiles) {
  let entries
  try {
    entries = fs.readdirSync(eventsDir)
  } catch {
    return
  }

  const files = entries
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const full = path.join(eventsDir, name)
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(full).mtimeMs
      } catch {
        mtimeMs = 0
      }
      return { name, full, mtimeMs }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first

  const excess = files.length - maxFiles
  if (excess <= 0) return

  for (let i = 0; i < excess; i++) {
    try {
      fs.unlinkSync(files[i].full)
      debugLog(`removed old event file ${files[i].name} (log file count cap ${maxFiles} reached)`)
    } catch (err) {
      debugLog(`could not remove old event file ${files[i].name}: ${err && err.message}`)
    }
  }
}

module.exports = { rotateIfNeeded, enforceFileCountCap }
