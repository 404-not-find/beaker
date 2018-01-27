const yo = require('yo-yo')
const co = require('co')
const {DownloadsList} = require('builtin-pages-lib')
import {render as renderDownloadsList} from '../com/downloads-list'

// globals
// =

var downloadsList

// main
// =

co(function * () {
  // fetch downloads
  downloadsList = new DownloadsList()
  yield downloadsList.setup()
  downloadsList.on('changed', render)

  // render
  render()
})

// rendering
// =

function render () {
  yo.update(document.querySelector('.downloads-wrapper'), yo`
    <div class="downloads-wrapper builtin-wrapper">
      <div>
        <div class="builtin-sidebar">
          <h1 class="title-heading">Downloads</h1>
        </div>

        <div class="builtin-main">
          ${renderDownloadsList(downloadsList)}
        </div>
      </div>
    </div>
  </div>`)
}
