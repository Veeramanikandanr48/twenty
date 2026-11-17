import { type PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { isDefined } from 'twenty-shared/utils';

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

    const releaseOrDestroyConnection: ReleaseConnection = (error) =>
      releaseConnection(
        error ??
          (hasQueryInFlight(connection)
            ? new Error('Connection released while a query is still running')
            : undefined),
      );

    return [connection, releaseOrDestroyConnection];
  };
};
