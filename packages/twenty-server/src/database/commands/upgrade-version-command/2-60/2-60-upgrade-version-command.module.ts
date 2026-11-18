import { Module } from '@nestjs/common';

import { WorkspaceIteratorModule } from 'src/database/commands/command-runners/workspace-iterator.module';
import { PointAccountsCommandMenuItemsToAppPreferencesCommand } from 'src/database/commands/upgrade-version-command/2-60/2-60-workspace-command-1794826956977-point-accounts-command-menu-items-to-app-preferences.command';
import { DropWorkspaceWorkflowVersionObjectCommand } from 'src/database/commands/upgrade-version-command/2-60/2-60-workspace-command-1794913859925-drop-workspace-workflow-version-object.command';
import { BackfillTaskLivePositionIndexCommand } from 'src/database/commands/upgrade-version-command/2-60/2-60-workspace-command-1794985154131-backfill-task-live-position-index.command';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { WorkspaceSchemaManagerModule } from 'src/engine/twenty-orm/workspace-schema-manager/workspace-schema-manager.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';

@Module({
  imports: [
    ApplicationModule,
    WorkspaceCacheModule,
    WorkspaceIteratorModule,
    WorkspaceMigrationModule,
    WorkspaceSchemaManagerModule,
  ],
  providers: [
    PointAccountsCommandMenuItemsToAppPreferencesCommand,
    DropWorkspaceWorkflowVersionObjectCommand,
    BackfillTaskLivePositionIndexCommand,
  ],
})
export class V2_60_UpgradeVersionCommandModule {}
