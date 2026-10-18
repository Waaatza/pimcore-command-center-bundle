import { container, type AbstractModule } from '@pimcore/studio-ui-bundle'
import { serviceIds } from '@pimcore/studio-ui-bundle/app'
import { type MainNavRegistry } from '@pimcore/studio-ui-bundle/modules/app'
import { type WidgetRegistry } from '@pimcore/studio-ui-bundle/modules/widget-manager'
import { CommandCenter } from '../components/command-center/command-center'

export const CommandCenterModule: AbstractModule = {
  onInit: (): void => {
    container.get<WidgetRegistry>(serviceIds.widgetManager).registerWidget({
      name: 'command-center', component: CommandCenter
    })
    container.get<MainNavRegistry>(serviceIds.mainNavRegistry).registerMainNavItem({
      path: 'System/Command Center',
      label: 'command-center.title',
      permission: 'admin',
      widgetConfig: {
        id: 'command-center', name: 'Command Control Center', component: 'command-center',
        config: { translationKey: 'command-center.title', icon: { type: 'name', value: 'accessory' } }
      }
    })
  }
}
