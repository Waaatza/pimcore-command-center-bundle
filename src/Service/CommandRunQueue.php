<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandRunQueue
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandHistoryStore $history,
    ) {
    }

    /** Queue a single command run. The matching history record is created as "queued". */
    public function enqueue(CommandRunParameters $parameters, array $context): array
    {
        return $this->storage->transaction('run-queue', 'jobs', function (?array &$jobs) use ($parameters, $context): array {
            $jobs ??= [];
            if (count($jobs) >= 100) {
                throw new BadRequestHttpException('Maximum of 100 queued runs reached.');
            }
            $id = $this->history->start($parameters, $context, 'queued');
            $jobs[$id] = [
                'id' => $id, 'status' => 'queued', 'context' => $context,
                'command' => $parameters->command, 'tokens' => $parameters->tokens, 'phpCode' => $parameters->phpCode,
            ];

            return ['id' => $id, 'status' => 'queued'];
        });
    }
}
