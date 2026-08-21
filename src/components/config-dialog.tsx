import { Cpu, PersonPencil, Puzzle, Wrench } from '@gravity-ui/icons'
import { cn, Modal } from '@heroui/react'
import { useDisclosure } from '@overlastic/react'
import { useState } from 'react'
import { Case, Switch } from 'react-if-lite'
import { ConfigCore } from './config-core'
import { ConfigDebug } from './config-debug'
import { ConfigPlugin } from './config-plugin'
import { ConfigProfile } from './config-profile'

export function ConfigDialog() {
  const disclosure = useDisclosure()
  const navs = [
    {
      title: '调试',
      label: 'Debug',
      value: 'debug',
      icon: Wrench,
    },
    {
      title: '档案',
      label: 'Profiles',
      value: 'profiles',
      icon: PersonPencil,
    },
    {
      title: '插件',
      label: 'Plugins',
      value: 'plugins',
      icon: Puzzle,
    },
    {
      title: '核心',
      label: 'Harness',
      value: 'harness',
      icon: Cpu,
    },
  ]

  const [activeTab, setActiveTab] = useState('debug')
  return (
    <Modal isOpen={disclosure.visible} onOpenChange={disclosure.confirm}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog className="w-[800px] max-w-[calc(100vw-48px)] pr-2.5">
            <Modal.CloseTrigger />
            <Modal.Header className="mb-3">
              <Modal.Heading>
                应用配置
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex gap-6 pr-0">
              <aside className="w-[164px]">
                <nav className="flex flex-col gap-2 w-full">
                  {navs.map((item) => {
                    const isActive = item.value === activeTab
                    return (
                      <button
                        key={item.value}
                        onClick={() => setActiveTab(item.value)}
                        className={cn(
                          'text-foreground h-[40px] rounded-md flex items-center gap-2 py-[9px] px-[16px] hover:bg-background-secondary cursor-pointer',
                          isActive ? 'bg-background-secondary' : '',
                        )}
                      >
                        <item.icon className="w-5 h-5 mr-2" />
                        <span>{item.title}</span>
                      </button>
                    )
                  })}
                </nav>
              </aside>
              <div className="flex flex-col flex-1 overflow-auto h-[628px] pr-2.5">
                <Switch value={activeTab}>
                  <Case cond="debug">
                    <ConfigDebug />
                  </Case>
                  <Case cond="profiles">
                    <ConfigProfile />
                  </Case>
                  <Case cond="plugins">
                    <ConfigPlugin />
                  </Case>
                  <Case cond="harness">
                    <ConfigCore />
                  </Case>
                </Switch>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
