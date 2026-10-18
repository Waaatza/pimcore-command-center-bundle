<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\CommandScheduleService;

/** @internal */
final class ScheduleDetailController
{
    private const string ROUTE = '/command-center/schedules/{id}';

    public function __construct(private readonly CommandScheduleService $service)
    {
    }

    #[Route(self::ROUTE, name: 'watza_command_center_scheduledetail', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: self::ROUTE, summary: 'command_center_scheduledetail', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_scheduledetail_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(string $id): JsonResponse
    {
        return new JsonResponse($this->service->get($id));
    }
}
