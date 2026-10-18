<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\CommandScheduleService;

/** @internal */
final class SchedulesController
{
    private const string ROUTE = '/command-center/schedules';

    public function __construct(private readonly CommandScheduleService $service)
    {
    }

    #[Route(self::ROUTE, name: 'watza_command_center_schedules', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: self::ROUTE, summary: 'command_center_schedules', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_schedules_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse($this->service->list());
    }
}
