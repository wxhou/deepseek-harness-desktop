import { useWatch } from '@hairy/react-lib'
import { useStore } from 'valtio-define'
import { updater } from '../store/modules/updater'
/** 右下角"发现新版本"提示条：状态与操作直接来自 updater store */
export default function HarnessUpdater() {
  const { updateInfo, updating } = useStore(updater)

  useWatch([updateInfo, updating], () => {
    if (!updateInfo || updating)
      return null
    updater.showToast()
  }, { immediate: true })

  return null
}
