import { useEffect } from 'react'
import { StorageError } from './components/ErrorBoundary'
import { TabBar } from './components/Layout'
import { UpdateBanner } from './components/UpdateBanner'
import { useDbError } from './lib/db'
import { requestPersistentStorage, usePref } from './lib/device'
import { useThemeSync } from './lib/hooks'
import { navigate, useRoute } from './lib/router'
import { DailyScreen } from './screens/Daily'
import { GuideScreen } from './screens/Guide'
import { HomeScreen } from './screens/Home'
import { ManualScreen } from './screens/Manual'
import { MeasureScreen } from './screens/Measure'
import { ReportScreen } from './screens/Report'
import { SettingsScreen } from './screens/Settings'
import { TrendsScreen } from './screens/Trends'

export default function App() {
  useThemeSync()
  const route = useRoute()
  const [onboarded, setOnboarded] = usePref('onboarded', '')
  const dbError = useDbError()

  useEffect(() => {
    void requestPersistentStorage()
  }, [])

  if (dbError) {
    return (
      <>
        <div className="statusbar-strip" />
        <StorageError message={dbError} />
      </>
    )
  }

  // 第一次使用：先看完說明再進 App
  if (!onboarded) {
    return (
      <>
        <div className="statusbar-strip" />
        <GuideScreen
          firstRun
          onDone={() => {
            setOnboarded('1')
            window.scrollTo(0, 0)
          }}
        />
        <UpdateBanner hidden={false} />
      </>
    )
  }

  const showTabs =
    route.name === 'home' ||
    route.name === 'daily' ||
    route.name === 'trends' ||
    route.name === 'report' ||
    route.name === 'settings'

  return (
    <>
      <div className="statusbar-strip" />
      {route.name === 'home' && <HomeScreen />}
      {route.name === 'measure' && <MeasureScreen />}
      {route.name === 'manual' && <ManualScreen />}
      {route.name === 'daily' && <DailyScreen date={route.date} />}
      {route.name === 'trends' && <TrendsScreen />}
      {route.name === 'report' && <ReportScreen />}
      {route.name === 'settings' && <SettingsScreen />}
      {route.name === 'guide' && <GuideScreen onDone={() => navigate('/settings', { replace: true })} />}
      {showTabs && <TabBar current={route.name === 'report' ? 'trends' : route.name} />}
      <UpdateBanner hidden={route.name === 'measure'} />
    </>
  )
}
