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
  tick('problems', button.dataset.presetProblems)
  tick('drills', button.dataset.presetDrills)
  form.dispatchEvent(new Event('change', { bubbles: true }))
})

/**
 * Contribute page: repeatable rows. A `[data-add-row="x"]` button clones
 * `template[data-row-template="x"]` into `[data-rows="x"]`, both looked up in
 * the nearest `[data-rows-scope]` (the form, or one layer for its options).
 * The template's placeholder (`__i__`, `__j__`) becomes the next free index.
 * `data-preset` (JSON) pre-fills the new row's key / kind / prompt.
 */
document.addEventListener('click', (event) => {
  const add = event.target.closest('[data-add-row]')
  const remove = event.target.closest('[data-remove-row]')
  if (!add && !remove) return

  const form = (add ?? remove).closest('form')
  if (add) {
    const name = add.dataset.addRow
    const scope = add.closest('[data-rows-scope]')
    const list = scope.querySelector(`[data-rows="${name}"]`)
    const template = scope.querySelector(`template[data-row-template="${name}"]`)
    const index = Number(list.dataset.next || 0)
    list.dataset.next = String(index + 1)
    list.insertAdjacentHTML(
      'beforeend',
      template.innerHTML.replaceAll(template.dataset.placeholder, String(index))
    )
    const row = list.lastElementChild
    if (add.dataset.preset) {
      const preset = JSON.parse(add.dataset.preset)
      for (const [field, value] of Object.entries(preset)) {
        const input = row.querySelector(`[name$="[${field}]"]`)
        if (input) input.value = value
      }
    }
    row.querySelector('input, select, textarea')?.focus()
  } else {
    remove.closest('[data-row]').remove()
  }
  form.dispatchEvent(new Event('change', { bubbles: true }))
})

/**
 * "Copy" on the contribute page's preview.
 */
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]')
  if (!button) return
  const source = document.querySelector(button.dataset.copy)
  await navigator.clipboard.writeText(source.textContent)
  const label = button.textContent
  button.textContent = button.dataset.copied ?? 'Copied'
  setTimeout(() => (button.textContent = label), 1500)
})
