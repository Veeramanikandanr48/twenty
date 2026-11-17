import { Logger } from '@nestjs/common';

import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { isDefined } from 'twenty-shared/utils';

const logger = new Logger('destroyConnectionsReleasedMidQuery');

type ReleaseConnection = (error?: Error) => void;

const hasQueryInFlight = (connection: object): boolean =>
  'activeQuery' in connection && isDefined(connection.activeQuery);

export const destroyConnectionsReleasedMidQuery = (
  driver: Pick<PostgresDriver, 'obtainMasterConnection'>,
): void => {
  const obtainMasterConnection = driver.obtainMasterConnection.bind(driver);

  driver.obtainMasterConnection = async () => {
    const [connection, releaseConnection] =
      (await obtainMasterConnection()) as [object, ReleaseConnection];

    const releaseOrDestroyConnection: ReleaseConnection = (error) => {
      if (isDefined(error) || !hasQueryInFlight(connection)) {
        releaseConnection(error);

        return;
      }

      logger.warn(
        'Destroying core connection released while a query is still running',
      );

      releaseConnection(
        new Error('Connection released while a query is still running'),
      );
    };

    return [connection, releaseOrDestroyConnection];
  };
};
