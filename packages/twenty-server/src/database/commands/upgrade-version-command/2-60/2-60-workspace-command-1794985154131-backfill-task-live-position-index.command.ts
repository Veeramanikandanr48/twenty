import { Command } from 'nest-commander';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { IndexType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { generateFlatIndexMetadataWithNameOrThrow } from 'src/engine/metadata-modules/index-metadata/utils/generate-flat-index.util';
import { WorkspaceSchemaManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/workspace-schema-manager.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';
import { getWorkspaceSchemaContextForMigration } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/utils/get-workspace-schema-context-for-migration.util';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { type UniversalFlatIndexMetadata } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/universal-flat-index-metadata.type';

const TASK = STANDARD_OBJECTS.task;
const LIVE_POSITION_INDEX = TASK.indexes.livePositionIndex;

// The standard application is only synchronized when a workspace is created,
// so existing workspaces need an explicit backfill. Build the index outside
// the migration transaction to avoid write-blocking large task tables, and
// reconcile metadata and physical state independently so reruns are safe.
@RegisteredWorkspaceCommand('2.60.0', 1794985154131)
@Command({
  name: 'upgrade:2-60:backfill-task-live-position-index',
  description:
    'Create the partial live-task position index for existing workspaces with CONCURRENTLY so writes are not blocked.',
})
export class BackfillTaskLivePositionIndexCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly workspaceSchemaManagerService: WorkspaceSchemaManagerService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    dataSource,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;

    if (!dataSource) {
      this.logger.log(`No data source for workspace ${workspaceId}, skipping`);

      return;
    }

    const { flatObjectMetadataMaps, flatFieldMetadataMaps, flatIndexMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
        'flatIndexMaps',
      ]);

    const taskFlatObjectMetadata =
      findFlatEntityByUniversalIdentifier<FlatObjectMetadata>({
        flatEntityMaps: flatObjectMetadataMaps,
        universalIdentifier: TASK.universalIdentifier,
      });

    if (!isDefined(taskFlatObjectMetadata)) {
      this.logger.log(
        `task object not found for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const positionFlatFieldMetadata =
      findFlatEntityByUniversalIdentifier<FlatFieldMetadata>({
        flatEntityMaps: flatFieldMetadataMaps,
        universalIdentifier: TASK.fields.position.universalIdentifier,
      });

    if (!isDefined(positionFlatFieldMetadata)) {
      this.logger.log(
        `position field not found on task for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    const now = new Date().toISOString();
    const universalFlatIndexMetadata: UniversalFlatIndexMetadata =
      generateFlatIndexMetadataWithNameOrThrow({
        flatObjectMetadata: taskFlatObjectMetadata,
        objectFlatFieldMetadatas: [positionFlatFieldMetadata],
        flatIndex: {
          createdAt: now,
          updatedAt: now,
          universalIdentifier: LIVE_POSITION_INDEX.universalIdentifier,
          applicationUniversalIdentifier:
            TWENTY_STANDARD_APPLICATION.universalIdentifier,
          objectMetadataUniversalIdentifier:
            taskFlatObjectMetadata.universalIdentifier,
          indexType: IndexType.BTREE,
          indexWhereClause: '"deletedAt" IS NULL',
          isCustom: false,
          isUnique: false,
          isSystemSideEffect: true,
          universalFlatIndexFieldMetadatas: [
            {
              createdAt: now,
              updatedAt: now,
              indexMetadataUniversalIdentifier:
                LIVE_POSITION_INDEX.universalIdentifier,
              fieldMetadataUniversalIdentifier:
                positionFlatFieldMetadata.universalIdentifier,
              order: 0,
              subFieldName: null,
            },
          ],
        },
      });

    const isMetadataPresent = isDefined(
      flatIndexMaps.byUniversalIdentifier[
        LIVE_POSITION_INDEX.universalIdentifier
      ],
    );
    const { schemaName, tableName } = getWorkspaceSchemaContextForMigration({
      workspaceId,
      objectMetadata: taskFlatObjectMetadata,
    });
    const queryRunner = dataSource.createQueryRunner();
    let isQueryRunnerConnected = false;
    let previousStatementTimeout: string | undefined;

    let shouldCreatePhysicalIndex = true;

    try {
      await queryRunner.connect();
      isQueryRunnerConnected = true;

      const statementTimeoutRows: { statement_timeout: string }[] =
        await queryRunner.query('SHOW statement_timeout');

      previousStatementTimeout = statementTimeoutRows[0]?.statement_timeout;

      // Concurrent index builds can outlive the default statement timeout.
      await queryRunner.query(
        "SELECT set_config('statement_timeout', '0', false)",
      );

      const physicalIndexRows: { isValid: boolean }[] = await queryRunner.query(
        `SELECT i.indisvalid AS "isValid"
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_index i ON i.indexrelid = c.oid
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schemaName, universalFlatIndexMetadata.name],
      );
      const isValidPhysicalIndex = physicalIndexRows[0]?.isValid === true;

      shouldCreatePhysicalIndex = !isValidPhysicalIndex;

      this.logger.log(
        `${isDryRun ? '[DRY RUN] ' : ''}Live position index for workspace ${workspaceId}: metadata ${isMetadataPresent ? 'present' : 'missing'}, physical ${isValidPhysicalIndex ? 'valid' : shouldCreatePhysicalIndex && physicalIndexRows.length > 0 ? 'invalid' : 'missing'}`,
      );

      if (isDryRun) {
        return;
      }

      if (shouldCreatePhysicalIndex) {
        if (physicalIndexRows.length > 0) {
          await this.workspaceSchemaManagerService.indexManager.dropIndex({
            queryRunner,
            schemaName,
            indexName: universalFlatIndexMetadata.name,
            concurrently: true,
          });
        }

        await this.workspaceSchemaManagerService.indexManager.createIndex({
          queryRunner,
          schemaName,
          tableName,
          index: {
            name: universalFlatIndexMetadata.name,
            columns: [positionFlatFieldMetadata.name],
            isUnique: universalFlatIndexMetadata.isUnique,
            type: universalFlatIndexMetadata.indexType,
            where: universalFlatIndexMetadata.indexWhereClause ?? undefined,
          },
          concurrently: true,
        });
      }
    } finally {
      try {
        if (isQueryRunnerConnected && isDefined(previousStatementTimeout)) {
          await queryRunner.query(
            "SELECT set_config('statement_timeout', $1, false)",
            [previousStatementTimeout],
          );
        }
      } finally {
        if (isQueryRunnerConnected) {
          await queryRunner.release();
        }
      }
    }

    if (isMetadataPresent) {
      this.logger.log(
        `Live position index metadata already present for workspace ${workspaceId}`,
      );

      return;
    }

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          shouldDeferActions: false,
          isSystemBuild: true,
          allFlatEntityOperationByMetadataName: {
            index: {
              flatEntityToCreate: [universalFlatIndexMetadata],
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to persist live position index metadata:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );
      throw new Error(
        `Failed to persist live position index metadata for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Backfilled live position index for workspace ${workspaceId}`,
    );
  }
}
