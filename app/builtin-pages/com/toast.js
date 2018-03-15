import yo from 'yo-yo'

function render (message, type = '') {
  return yo`
    <div id="toast-wrapper" class="toast-wrapper">
      <p class="toast ${type}">${message}</p>
    </div>
  `
}

export function create (message, type = '', time = 1500) {
  // render toast
  var toast = render(message, type)
  document.body.appendChild(toast)
  setTimeout(destroy, time)
}

function destroy () {
  var toast = document.getElementById('toast-wrapper')

  // fadeout before removing element
  toast.classList.add('hidden')
  setTimeout(() => document.body.removeChild(toast), 500)
}
