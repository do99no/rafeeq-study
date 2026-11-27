import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useNewVersion, watchVersion } from '../lib/version'

/** تنبيه بنسخة أحدث منشورة؛ التحديث بضغطة (لا يُفرض فجأة كي لا يضيع ما يكتبه الطالب) */
export function UpdateBanner() {
  const v = useNewVersion()
  useEffect(watchVersion, [])
  if (!v) return null
  return (
    <div className="update-banner" role="status">
      <span>نسخة أحدث من رفيق متاحة.</span>
      <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>
        <RefreshCw aria-hidden="true" /> حدّث الآن
      </button>
    </div>
  )
}
