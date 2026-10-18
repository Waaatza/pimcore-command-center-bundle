import React from 'react'
import { useTranslation } from '@pimcore/studio-ui-bundle/app'
import { Form, Input, Select, Switch, TextArea } from '@pimcore/studio-ui-bundle/components'

export interface InputField {
  name: string
  label: string
  type: 'string' | 'integer' | 'choice'
  required?: boolean
  default?: string
  choices?: string[]
}

const RequiredField = ({ value, onChange }: { value?: boolean, onChange?: (value: boolean) => void }): React.JSX.Element => (
  <Switch checked={ value === true } onChange={ (checked) => onChange?.(checked) } />
)

const ChoicesField = ({ value, onChange }: { value?: string[] | null, onChange?: (value: string[]) => void }): React.JSX.Element => (
  <TextArea value={ (value ?? []).join('\n') } onChange={ event => onChange?.(event.target.value.split('\n')) } />
)

export const InputFieldEditor = ({ field }: { field?: InputField }): React.JSX.Element => {
  const { t } = useTranslation()
  return (
    <>
      <Form.Item label={ t('command-center.templates.field-name') } name="name" initialValue="">
        <Input />
      </Form.Item>
      <Form.Item label={ t('command-center.templates.label') } name="label" initialValue="">
        <Input />
      </Form.Item>
      <Form.Item label={ t('command-center.templates.type') } name="type" initialValue="string">
        <Select options={ ['string', 'integer', 'choice'].map(type => ({ value: type, label: t(`command-center.templates.type.${type}`) })) } />
      </Form.Item>
      <Form.Item label={ t('command-center.templates.default') } name="default" initialValue="">
        <Input />
      </Form.Item>
      {field?.type === 'choice' && (
        <Form.Item label={ t('command-center.templates.choices') } name="choices">
          <ChoicesField />
        </Form.Item>
      ) }
      <Form.Item label={ t('command-center.templates.required') } name="required" initialValue={ true }>
        <RequiredField />
      </Form.Item>
    </>
  )
}


export const InputFields = ({ fields, values, onChange }: {
  fields: InputField[], values: Record<string, string>, onChange: (values: Record<string, string>) => void
}): React.JSX.Element => <>{fields.map(field => (
  <Form.Item key={field.name} label={`${field.label}${field.required === true ? ' *' : ''}`}>
    {field.type === 'choice'
      ? <Select value={values[field.name] ?? field.default ?? ''}
          options={(field.choices ?? []).map(value => ({ value, label: value }))}
          onChange={(value: string) => onChange({ ...values, [field.name]: value })} />
      : <Input type={field.type === 'integer' ? 'number' : 'text'} value={values[field.name] ?? field.default ?? ''}
          onChange={event => onChange({ ...values, [field.name]: event.target.value })} />}
  </Form.Item>
))}</>
