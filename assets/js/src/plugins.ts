import { type IAbstractPlugin } from '@pimcore/studio-ui-bundle'
import { CommandCenterModule } from './modules/command-center'

export const CommandCenterPlugin: IAbstractPlugin = {
  name: 'Command Control Center',
  onStartup ({ moduleSystem }) {
    moduleSystem.registerModule(CommandCenterModule)
  }
}
