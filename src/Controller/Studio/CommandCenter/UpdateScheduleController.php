<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\CommandScheduleUpdateParameters;
use Watza\CommandCenterBundle\Service\CommandScheduleService;

/** @internal */
final class UpdateScheduleController
{
    private const string ROUTE = '/command-center/schedules/update';

    public function __construct(private readonly CommandScheduleService $service)
    {
    }

    #[Route(self::ROUTE, name: 'watza_command_center_updateschedule', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: self::ROUTE, summary: 'command_center_updateschedule', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_updateschedule_success')]
    #[OA\Response(response: 409, description: 'Schedule running or modified since editing began')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] CommandScheduleUpdateParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->update($parameters));
    }
}
