/**
 * Field for bots only: hidden from people and assistive technology, skipped by Tab.
 * The server rejects submissions where `website` is not empty.
 */
export function Honeypot() {
  return (
    <div className="hp" aria-hidden="true">
      <label>
        Strona internetowa (zostaw puste)
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  )
}
