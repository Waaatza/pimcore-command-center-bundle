<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\DependencyInjection\Attribute\TaggedIterator;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Parameter\TemplateSaveParameters;
use Watza\CommandCenterBundle\Preview\CommandPreviewProviderInterface;

/** @internal */
final readonly class CommandTemplateService
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        #[TaggedIterator('command_center.preview_provider')]
        private iterable $previewProviders = [],
        private CommandInputResolver $inputs = new CommandInputResolver(),
    ) {
    }

    public function list(): array
    {
        $items = array_values($this->storage->read('templates', 'catalog') ?? []);
        usort($items, static fn (array $a, array $b): int => strnatcasecmp($a['label'], $b['label']));
        foreach ($items as &$item) {
            $item['previewSupported'] = $this->provider($item['command']) !== null;
        }

        return ['items' => $items];
    }

    public function save(TemplateSaveParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->validateDefinition($parameters);
        $this->commands->validate(new CommandRunParameters(
            $parameters->command, tokens: $parameters->tokens, phpCode: $parameters->phpCode,
        ));

        return $this->storage->transaction('templates', 'catalog', function (?array &$items) use ($parameters): array {
            $items ??= [];
            $id = $parameters->id ?? bin2hex(random_bytes(16));
            $old = $parameters->id === null ? null : $this->find($items, $id, $parameters->revision);
            $item = [
                'id' => $id, 'revision' => ($old['revision'] ?? 0) + 1,
                'label' => trim($parameters->label), 'description' => trim($parameters->description),
                'command' => $parameters->command, 'tokens' => $parameters->tokens,
                'fields' => $parameters->fields, 'phpCode' => $parameters->phpCode,
                'createdAt' => $old['createdAt'] ?? gmdate(DATE_ATOM), 'updatedAt' => gmdate(DATE_ATOM),
            ];
            $items[$id] = $item;

            return $item;
        });
    }

    public function delete(TemplateActionParameters $parameters): void
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->storage->transaction('templates', 'catalog', function (?array &$items) use ($parameters): void {
            $this->find($items ?? [], $parameters->id, $parameters->revision);
            unset($items[$parameters->id]);
        });
    }

    public function preview(TemplateActionParameters $parameters): array
    {
        [$item, $run] = $this->resolve($parameters);
        $provider = $this->provider($item['command']);
        if ($provider === null) {
            return ['supported' => false];
        }
        $result = $provider->preview($run->tokens);

        return ['supported' => true, 'count' => $result->count, 'samples' => $result->samples,
            'message' => $result->message];
    }

    public function run(TemplateActionParameters $parameters): StreamedResponse
    {
        [$item, $run] = $this->resolve($parameters);

        return $this->commands->run($run, [
            'source' => 'template', 'templateId' => $item['id'], 'templateLabel' => $item['label'],
            'inputValues' => $this->inputs->values($item['fields'], $parameters->values),
        ]);
    }

    /** @return array{array, CommandRunParameters} */
    public function resolve(TemplateActionParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $item = $this->find($this->storage->read('templates', 'catalog') ?? [], $parameters->id, $parameters->revision);
        $values = $this->inputs->values($item['fields'], $parameters->values);
        $tokens = $this->inputs->tokens($item['tokens'], $values);
        $run = new CommandRunParameters($item['command'], $parameters->csrfToken, $tokens, $item['phpCode'] ?? null);
        $this->commands->validate($run);

        return [$item, $run];
    }

    private function find(array $items, string $id, ?int $revision): array
    {
        $item = $items[$id] ?? throw new NotFoundHttpException('Template not found.');
        if ($revision !== $item['revision']) {
            throw new ConflictHttpException('Template changed. Reload before continuing.');
        }

        return $item;
    }

    private function validateDefinition(TemplateSaveParameters $parameters): void
    {
        if (trim($parameters->label) === '' || strlen($parameters->label) > 120
            || strlen($parameters->description) > 2000 || !array_is_list($parameters->tokens)
            || count($parameters->tokens) > 100 || !array_is_list($parameters->fields)
            || count($parameters->fields) > 30) {
            throw new BadRequestHttpException('Invalid template definition.');
        }
        $this->inputs->validateFields($parameters->fields);
        $this->inputs->validateTokens($parameters->tokens, $parameters->fields);
    }

    public function hasPreview(string $command): bool
    {
        return $this->provider($command) !== null;
    }

    private function provider(string $command): ?CommandPreviewProviderInterface
    {
        $found = null;
        foreach ($this->previewProviders as $provider) {
            if ($provider->command() === $command) {
                if ($found !== null) {
                    throw new \LogicException('Multiple preview providers registered for ' . $command);
                }
                $found = $provider;
            }
        }

        return $found;
    }
}
