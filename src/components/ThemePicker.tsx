import { useAuth } from '../auth/authContext'
import { isTheme, THEMES } from '../theme'

/** Theme select, used in the header and on the login page. */
export default function ThemePicker() {
  const { theme, setTheme } = useAuth()
  return (
    <label className="theme-picker">
      <span>Theme</span>
      <select
        value={theme}
        onChange={(e) => {
          if (isTheme(e.target.value)) setTheme(e.target.value)
        }}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  )
}
