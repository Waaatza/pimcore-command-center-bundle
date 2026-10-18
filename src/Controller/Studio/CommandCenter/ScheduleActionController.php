<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\CommandScheduleActionParameters;
use Watza\CommandCenterBundle\Service\CommandScheduleService;

/** @internal */
final class ScheduleActionController
{
    private const string ROUTE = '/command-center/schedules/action';

    public function __construct(private readonly CommandScheduleService $service)
    {
    }

    #[Route(self::ROUTE, name: 'watza_command_center_scheduleaction', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: self::ROUTE, summary: 'command_center_scheduleaction', tags: ['Command Center'])]
    #[OA\Response(response: 204, description: 'command_center_scheduleaction_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] CommandScheduleActionParameters $parameters): Response
    {
        $this->service->action($parameters);

        return new Response(null, 204);
    }
}
