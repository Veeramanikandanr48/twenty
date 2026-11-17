import { type DataSource, type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type SlowInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/slow-instance-command.interface';

@RegisteredInstanceCommand('2.60.0', 1794927823926, { type: 'slow' })
export class AddRequestedRoleIdToApplicationSlowInstanceCommand
  implements SlowInstanceCommand
{
  async runDataMigration(_dataSource: DataSource): Promise<void> {}

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."application" ADD "requestedRoleId" uuid',
    );
    await queryRunner.query(
      'UPDATE "core"."application" SET "requestedRoleId" = "defaultRoleId" WHERE "defaultRoleId" IS NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."application" DROP COLUMN "requestedRoleId"',
    );
  }
}
