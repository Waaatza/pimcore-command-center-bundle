<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;

/** @internal */
final class RunController
{
    public function __construct(private readonly CommandCenterService $service)
    {
    }

    #[Route('/command-center/run', name: 'watza_command_center_run', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/run', summary: 'command_center_run', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_run_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] CommandRunParameters $parameters): StreamedResponse
    {
        return $this->service->run($parameters);
    }
}
