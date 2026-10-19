import { container, type AbstractModule } from '@pimcore/studio-ui-bundle'
import { serviceIds } from '@pimcore/studio-ui-bundle/app'
import { type MainNavRegistry, type ComponentRegistryInterface } from '@pimcore/studio-ui-bundle/modules/app'
import { type WidgetRegistry } from '@pimcore/studio-ui-bundle/modules/widget-manager'
import { CommandCenter } from '../components/command-center/command-center'
import { CommandCenterNavTitle } from '../components/command-center/nav-title'
import { GlobalActionButtons, ObjectActionButtons, AssetActionButtons, DocumentActionButtons } from '../components/command-center/studio-action-buttons'

export const CommandCenterModule: AbstractModule = {
  onInit: (): void => {
    const registry = container.get<ComponentRegistryInterface>(serviceIds['App/ComponentRegistry/ComponentRegistry'])
    registry.registerToSlot('leftSidebar.slot', { name: 'command-center-actions', component: GlobalActionButtons, priority: 300 })
    registry.registerToSlot('dataObject.editor.toolbar.slots.right', { name: 'command-center-object-actions', component: ObjectActionButtons, priority: 50 })
    registry.registerToSlot('asset.editor.toolbar.slots.right', { name: 'command-center-asset-actions', component: AssetActionButtons, priority: 50 })
    registry.registerToSlot('document.editor.toolbar.slots.right', { name: 'command-center-document-actions', component: DocumentActionButtons, priority: 50 })
    container.get<WidgetRegistry>(serviceIds.widgetManager).registerWidget({
      name: 'command-center', component: CommandCenter, titleComponent: CommandCenterNavTitle
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
