import path from 'path'
import url from 'url'
import parseRange from 'range-parser'
import once from 'once'
import fs from 'fs'
import intoStream from 'into-stream'
import errorPage from '../error-page'
import {pluralize, makeSafe} from '../strings'
import * as mime from '../mime'
import * as scopedFSes from './scoped-fses'

// exported api
// =

export async function serve (request, respond, {CSP, scopedFSPath}) {
  // response helper
  const cb = once((statusCode, status, contentType, filepath) => {
    const headers = {
      'Content-Type': (contentType || 'text/html; charset=utf-8'),
      'Content-Security-Policy': CSP
    }
    if (typeof filepath === 'string') {
      respond({statusCode, headers, data: fs.createReadStream(filepath)})
    } else if (typeof filepath === 'function') {
      respond({statusCode, headers, data: intoStream(filepath())})
    } else {
      respond({statusCode, headers, data: intoStream(errorPage(statusCode + ' ' + status))})
    }
  })

  try {
    // read the parameters
    const requestUrl = request.url
    const requestUrlParsed = url.parse(requestUrl)

    // fail if no binding url is given
    if (!scopedFSPath) {
      return cb(404, 'Not Found', 'text/html', () => errorPage(`No workspace found at ${makeSafe(requestUrlParsed.hostname)}`))
    }

    // create/get the scoped fs
    const scopedFS = scopedFSes.get(scopedFSPath)

    // do a lookup
    let requestPathname = decodeURIComponent(requestUrlParsed.pathname)
    let stat = await new Promise(resolve => scopedFS.stat(requestPathname, (err, st) => resolve(st)))
    if (!stat) {
      return cb(404, 'Not Found')
    }

    // check for an index.html
    if (stat.isDirectory()) {
      let requestPathname2 = path.join(requestPathname, 'index.html')
      let stat2 = await new Promise(resolve => scopedFS.stat(requestPathname2, (err, st) => resolve(st)))
      if (stat2) {
        requestPathname = requestPathname2
        stat = stat2
      }
    }

    // directory listing
    if (stat.isDirectory()) {
      let listing = await new Promise(resolve => scopedFS.readdir(requestPathname, (err, ls) => resolve(ls)))
      listing = listing || []
      let html = await renderDirectoryListingPage(scopedFS, requestPathname, listing)
      return respond({
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': CSP
        },
        data: intoStream(html)
      })
    }

    // handle range
    let statusCode = 200
    let headers = {}
    let headersSent = false
    let range = request.headers.range && parseRange(stat.size, request.headers.range)
    headers['Accept-Ranges'] = 'bytes'
    if (range && range.type === 'bytes') {
      range = range[0] // only handle first range given
      statusCode = 206
      headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + stat.size
      headers['Content-Length'] = range.end - range.start + 1
    } else {
      if (stat.size) {
        headers['Content-Length'] = stat.size
      }
    }

    // fetch the entry and stream the response
    let fileReadStream = scopedFS.createReadStream(requestPathname, range)
    var dataStream = fileReadStream
      .pipe(mime.identifyStream(requestPathname, mimeType => {
        // send headers, now that we can identify the data
        headersSent = true
        Object.assign(headers, {
          'Content-Type': mimeType,
          'Content-Security-Policy': CSP,
          'Cache-Control': 'public, max-age: 60'
        })
        respond({statusCode, headers, data: dataStream})
      }))

    // handle empty files
    fileReadStream.once('end', () => {
      if (!headersSent) {
        respond({
          statusCode: 200,
          headers: {
            'Content-Security-Policy': CSP
          },
          data: intoStream('')
        })
      }
    })

    // handle read-stream errors
    fileReadStream.once('error', err => {
      if (!headersSent) cb(500, 'Failed to read file')
    })
  } catch (e) {
    cb(500, e.toString())
  }
}

// directory listing page
// =

const styles = `<style>
  .entry {
    background: no-repeat center left;
    padding: 3px 20px;
    font-family: Consolas, 'Lucida Console', Monaco, monospace;
    font-size: 13px;
  }
  .updog {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAKxJREFUeNpi/P//PwMlgImBQjAMDGBBF2BkZISz09LSwCE8a9YsuCBGoIMEkDEMJCUl/b90+QoYg9i41LNgc1ZycvL/hMQkhgcPH4H5iUnJIJf9nzt3LiNBL2RkZPwPj4hk4BMUYuDh44MEFDMLQ0xsHAMrKyvIJYyEwuDLiuXLeP7+/Qv3EihcmJmZGZiYmL5gqEcPFKBiAyDFjCPQ/wLVX8BrwGhSJh0ABBgAsetR5KBfw9EAAAAASUVORK5CYII=');
  }
  .directory {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACl0RVh0RGVzY3JpcHRpb24AQmFzZWQgb2YgSmFrdWIgU3RlaW5lciBkZXNpZ26ghAVzAAABbElEQVQ4jaWQO0tDQRCFz2x2A8YHQoogaKFW2qSysbATsdAIWgrWlhIFBRvLoFhZW/gb0vgPRBAStEgExZA2VR7X3Nw7MxY3BhUjCU6zMOz5zrcL/HPo/HDzREFnZMj1tgoI1FPm/ePL/M2fgNxRxltaXh8xxkCEoSIQYQQdH6XHO6/T8ZePL/PFfgBLCifCqJQfesswDNBoNhAEnQQRFXLZjV+qAefiRQsAba/e27MIWl4Ta1t7SE3N9lVXEVxfnaYtyJjS0z04DCMlF8fK6jaSyRQatUpfwFhypvsEUrOze4CxiUmoAlBF4LfwXq/1DUcG3UJhRmJ0HI1a9c/AzxGOAAYApEsbCiBfAMrDA5T5nwb8zYCHN/j8RABQFYAINGgYgEhUamPGKLOQiyciCFH3NABRdFsFqhoVqUJV4bebiBmjNmZd8eW5kJ6bXxhUAADw9lpWY12BLrKZRWNjt0EYTA8DsM5Vw7a/9gEhN65EVGzVRQAAAABJRU5ErkJggg==');
  }
  .file {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAASdEVYdFRpdGxlAFBhcGVyIFNoZWV0c7mvkfkAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACd0RVh0RGVzY3JpcHRpb24Ad2l0aCBhIEhVR0UgaGVscCBmcm9tIEpha3VihlQHswAAAhNJREFUOI11kstqU1EUhr91ctI2A2uTNsRaOxDEkeILiIgTL6CCAx+iUnTSgQPBRxAFSxWhA8XiBQst7aQjUV+kMWlzOaeJVZvsy3JwctK0wQWLvQabb/3/v7eoKuubqzdFZMk5PwuKqqIKoAB/Qba8d8/v3b2/xfFSVVbXPpWbUUO990Pd7Xa0Uv2paxurf1Y+vnucwA87AOh0OjP5iQL7v/dptWOacZ1ao0plZ5vdepV2q8Wt67dzxanik7fvlxcGBQQAxlgAqpUK5e0KO5Ua9d2IuNlmL/pFuVwhCAKuXrmWGx0Ze/pm+dXlFBAmAANAYSqPcy5p73DO4pwjE8OHzyuMZXNcvHAp9/3H1wXgWx9gjQGURi3CWjuU01S+xMkTBbxYgiCQg4ODGy9ePsvMzz1yfQUKTBTGcc7iVVHv8T5V4hhhFJExzp09z8bmesarzwIpINkaN1s454YUpCWBkC706gcysEkG+clxnPNo7y/0PsMhQHoAa1CvwyFCQBAoipBcFY4eyWCtxTt/FCBAHO3h7P8tZMIMpeI0xlh8z+pABkLpVBG0J1UGVKQKVBARrDH9rAaeERq1iG63298YhiFnZmf63rWXiTEGd9wCwOmZaUTkaA8ooJfpEEBEqnEcTRcKk//1n1a73QIkMtZ0EluqzD98cCfMhoum2y2pgpI84fEZlGx2pG6MmVtafP0F4B+wR1eZMTEGTgAAAABJRU5ErkJggg==');
  }
</style>`

async function renderDirectoryListingPage (scopedFS, dirPath, names) {
  // stat each file
  var entries = await Promise.all(names.map(async (name) => {
    var entryPath = path.join(dirPath, name)
    var entry = await new Promise(resolve => scopedFS.stat(entryPath, (err, st) => resolve(st)))
    if (entry) {
      entry.path = entryPath
      entry.name = name
    }
    return entry
  }))
  entries = entries.filter(Boolean)

  // sort the listing
  entries.sort((a, b) => {
    // directories on top
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    // alphabetical after that
    return a.name.localeCompare(b.name)
  })

  // show the updog if path is not top
  var updog = ''
  if (['/', '', '..'].includes(dirPath) === false) {
    updog = `<div class="entry updog"><a href="..">..</a></div>`
  }

  // render entries
  var totalFiles = 0
  entries = entries.map(entry => {
    totalFiles++
    var url = entry.path
    if (url.startsWith('/')) url = url.slice(1) // strip leading slash
    url = encodeURI(makeSafe(url)) // make safe
    url = '/' + url // readd leading slash
    if (entry.isDirectory() && !url.endsWith('/')) url += '/' // all dirs should have a trailing slash
    var type = entry.isDirectory() ? 'directory' : 'file'
    return `<div class="entry ${type}"><a href="${url}">${makeSafe(entry.name)}</a></div>`
  }).join('')

  // render summary
  var summary = `<div class="entry">${totalFiles} ${pluralize(totalFiles, 'file')}</div>`

  // render final
  return '<meta charset="UTF-8">' + styles + updog + entries + summary
}
