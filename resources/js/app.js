import htmx from 'htmx.org'

window.htmx = htmx

/**
 * Setup presets ("All subjects", "Only DP", "Same as last time"): tick the
 * matching chips, then fire `change` so HTMX refreshes the match count.
 */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-preset-subjects]')
  if (!button) return

  const form = button.closest('form')
  const tick = (name, values) => {
    if (values === undefined) return
    const wanted = values.split(',')
    for (const box of form.querySelectorAll(`input[name="${name}"]`)) {
      box.checked = wanted.includes(box.value)
    }
  }
  tick('subjects[]', button.dataset.presetSubjects)
  tick('tiers[]', button.dataset.presetTiers)
  form.dispatchEvent(new Event('change', { bubbles: true }))
})
