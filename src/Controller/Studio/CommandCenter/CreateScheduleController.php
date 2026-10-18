<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\CommandScheduleParameters;
use Watza\CommandCenterBundle\Service\CommandScheduleService;

/** @internal */
final class CreateScheduleController
{
    private const string ROUTE = '/command-center/schedules/create';

    public function __construct(private readonly CommandScheduleService $service)
    {
    }

    #[Route(self::ROUTE, name: 'watza_command_center_createschedule', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: self::ROUTE, summary: 'command_center_createschedule', tags: ['Command Center'])]
    #[OA\Response(response: 201, description: 'command_center_createschedule_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] CommandScheduleParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->create($parameters), 201);
    }
}
