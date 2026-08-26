import { renderHook, act, waitFor, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useJobStream } from '@/lib/useJobStream'
import { JobProgress } from '@/components/generate/JobProgress'
import { GenerateForm } from '@/components/generate/GenerateForm'
import { renderWithQuery, mockApi } from './helpers'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/briefs/br1',
}))

type Listener = (e: { data: string }) => void

class FakeEventSource {
  static last: FakeEventSource
  static created = 0
  onmessage: Listener | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners: Record<string, Listener[]> = {}
  constructor(public url: string) {
    FakeEventSource.last = this
    FakeEventSource.created += 1
  }
  addEventListener(name: string, fn: Listener) {
    ;(this.listeners[name] ??= []).push(fn)
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  emitRaw(data: string) {
    this.onmessage?.({ data })
  }
  emitEvent(name: string, payload: unknown) {
    this.listeners[name]?.forEach((fn) => fn({ data: JSON.stringify(payload) }))
  }
  fail() {
    this.onerror?.()
  }
  close() {
    this.closed = true
  }
}

const running = {
  job_id: 'j1',
  state: 'running',
  attempts: 1,
  progress: { stage: 'generating', percent: 30 },
  error: null,
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  FakeEventSource.created = 0
  push.mockReset()
})

describe('useJobStream', () => {
  it('exposes the latest snapshot', async () => {
    const { result } = renderHook(() => useJobStream('a1'))
    act(() => FakeEventSource.last.emit(running))
    await waitFor(() => expect(result.current.snapshot?.progress.percent).toBe(30))
  })

  it('connects through the same-origin authenticated proxy, not the backend directly', () => {
    renderHook(() => useJobStream('a1'))
    expect(FakeEventSource.last.url).toBe('/api/artifacts/a1/job/stream')
  })

  it('accepts a dev-harness url override without changing the default', () => {
    renderHook(() => useJobStream('sse_ok', { url: '/api/mock/stream/ok' }))
    expect(FakeEventSource.last.url).toBe('/api/mock/stream/ok')
  })

  it('closes the stream once the job is terminal', async () => {
    const { result } = renderHook(() => useJobStream('a1'))
    act(() =>
      FakeEventSource.last.emit({
        job_id: 'j1',
        state: 'succeeded',
        attempts: 1,
        progress: { stage: 'done', percent: 100 },
        error: null,
      }),
    )
    await waitFor(() => expect(FakeEventSource.last.closed).toBe(true))
    expect(result.current.snapshot?.state).toBe('succeeded')
  })

  it('reconnects after an error rather than giving up', async () => {
    renderHook(() => useJobStream('a1', { reconnectMs: 10 }))
    const original = FakeEventSource.last
    act(() => original.fail())
    await waitFor(() => expect(FakeEventSource.last).not.toBe(original))
    expect(original.closed).toBe(true)
  })

  it('does not open a stream without an artifact id', () => {
    const before = FakeEventSource.last
    renderHook(() => useJobStream(undefined))
    expect(FakeEventSource.last).toBe(before)
  })

  it('surfaces an auth failure and stops instead of retrying forever', async () => {
    const { result } = renderHook(() => useJobStream('a1', { reconnectMs: 10 }))
    const original = FakeEventSource.last
    act(() => original.emitEvent('stream_error', { status: 401, detail: 'not authenticated' }))
    await waitFor(() => expect(result.current.error).toBe('not authenticated'))
    expect(original.closed).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(FakeEventSource.created).toBe(1)
    expect(result.current.connected).toBe(false)
  })

  it('ignores a malformed event and keeps the stream open', async () => {
    const { result } = renderHook(() => useJobStream('a1'))
    act(() => FakeEventSource.last.emitRaw('{not json'))
    act(() => FakeEventSource.last.emit(running))
    await waitFor(() => expect(result.current.snapshot?.progress.percent).toBe(30))
    expect(FakeEventSource.last.closed).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('clears the reconnect timer on unmount', async () => {
    const { unmount } = renderHook(() => useJobStream('a1', { reconnectMs: 20 }))
    act(() => FakeEventSource.last.fail())
    unmount()
    await new Promise((r) => setTimeout(r, 80))
    expect(FakeEventSource.created).toBe(1)
  })
})

describe('JobProgress', () => {
  it('recovers the current stage when opened mid-generation', async () => {
    // PRD 7.1: a member can leave and come back.
    mockApi({ '/artifacts/a1/job': { ...running, progress: { stage: 'qa', percent: 70 } } })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() => expect(screen.getByText(/quality checks/i)).toBeInTheDocument())
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70')
  })

  it('shows the retry count when a job has been retried', async () => {
    mockApi({ '/artifacts/a1/job': { ...running, attempts: 2 } })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() => expect(screen.getByText(/attempt 2/i)).toBeInTheDocument())
  })

  it('shows the failure reason on a failed job', async () => {
    mockApi({
      '/artifacts/a1/job': { ...running, state: 'failed', attempts: 3, error: 'open-design unreachable' },
    })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('open-design unreachable'))
  })
})

const codingAgent = { id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }
const imageProvider = { id: 'p2', type: 'image_provider', name: 'gpt-image-2', enabled: true, created_at: '' }

function artifact(id: string) {
  return {
    id,
    brand_id: 'b1',
    brief_id: 'br1',
    copy_id: 'c1',
    artifact_type: 'carousel',
    generation_mode: 'code',
    model_provider_id: 'p1',
    status: 'queued',
    version: 1,
    parent_artifact_id: null,
    variant_group_id: null,
    open_design_project_ref: null,
    export_urls: {},
    qa_report: {},
    created_at: '',
  }
}

describe('GenerateForm', () => {
  it('routes straight to the artifact page for a single artifact', async () => {
    mockApi({ '/providers': [codingAgent, imageProvider], '/artifacts': [artifact('a1')] })
    renderWithQuery(<GenerateForm brandId="b1" briefId="br1" copyId="c1" />)
    await waitFor(() => screen.getByRole('option', { name: 'claude' }))
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: /^generate/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/artifacts/a1'))
  })

  it('keeps an inline progress list for variants and offers only matching providers', async () => {
    mockApi({
      '/providers': [codingAgent, imageProvider],
      '/artifacts': [artifact('a1'), artifact('a2')],
      '/artifacts/a1/job': running,
      '/artifacts/a2/job': running,
    })
    renderWithQuery(<GenerateForm brandId="b1" briefId="br1" copyId="c1" />)
    await waitFor(() => screen.getByRole('option', { name: 'claude' }))
    // A code artifact offers coding agents only; image offers image providers only.
    expect(screen.queryByRole('option', { name: 'gpt-image-2' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/artifact/i), { target: { value: 'image' } })
    expect(screen.getByRole('option', { name: 'gpt-image-2' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'claude' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/artifact/i), { target: { value: 'carousel' } })

    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'p1' } })
    fireEvent.change(screen.getByLabelText(/variants/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^generate/i }))
    await waitFor(() => expect(screen.getAllByRole('link', { name: /open artifact/i })).toHaveLength(2))
    expect(push).not.toHaveBeenCalled()
  })
})
