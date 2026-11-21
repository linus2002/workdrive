import { useDrive } from '../store/DriveStore';
import { LANGUAGES, resolveLanguage, useT } from './index';

/** Display-language picker for Settings: English / Filipino / Español (names shown in their own language). */
export default function LanguagePicker({ className = 'select', id }) {
  const { state, api } = useDrive();
  const t = useT();
  const value = resolveLanguage(state.settings?.language);
  return (
    <select id={id} className={className} aria-label={t('Display language')} value={value}
      onChange={(e) => api.updateSettings({ language: e.target.value })}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.locale}>{l.label}</option>)}
    </select>
  );
}
