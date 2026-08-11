import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from './Tooltip.jsx';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const hoverIn = (el) => fireEvent.mouseEnter(el);
  const settle = (ms = 400) => act(() => vi.advanceTimersByTime(ms));

  it('does not show before the delay elapses', () => {
    render(
      <Tooltip text="Next Track">
        <button>next</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    settle(200);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows after the delay and stays visible', () => {
    render(
      <Tooltip text="Next Track">
        <button>next</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    settle();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Next Track');

    // The flashing bug: it must still be there once time keeps passing.
    settle(3000);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Next Track');
  });

  it('hides on mouse leave', () => {
    render(
      <Tooltip text="Next Track">
        <button>next</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button');
    hoverIn(btn);
    settle();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('cancels a pending tooltip when the pointer leaves early', () => {
    render(
      <Tooltip text="Next Track">
        <button>next</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button');
    hoverIn(btn);
    settle(200);
    fireEvent.mouseLeave(btn);
    settle(1000);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on keyboard focus and hides on blur (gamepad focus ring)', () => {
    render(
      <Tooltip text="Restart Track">
        <button>restart</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    settle();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Restart Track');
    fireEvent.blur(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('preserves the child onClick and dismisses the hint', () => {
    const onClick = vi.fn();
    render(
      <Tooltip text="Pause">
        <button onClick={onClick}>pause</button>
      </Tooltip>
    );
    const btn = screen.getByRole('button');
    hoverIn(btn);
    settle();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it("preserves the child's own hover handlers", () => {
    const onMouseEnter = vi.fn();
    render(
      <Tooltip text="Mute">
        <button onMouseEnter={onMouseEnter}>mute</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('renders the child unchanged when text is empty', () => {
    render(
      <Tooltip text="">
        <button>bare</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    settle();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('hides on scroll, since the anchor rect is stale', () => {
    render(
      <Tooltip text="Add to Queue">
        <button>add</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    settle();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not leave a timer running after unmount', () => {
    const { unmount } = render(
      <Tooltip text="Shuffle">
        <button>shuffle</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    unmount();
    // Would throw on a setState-after-unmount if the timer survived.
    expect(() => settle(1000)).not.toThrow();
  });

  it('does not show on focus for a text-entry field (bubble would cover the text)', () => {
    render(
      <Tooltip text="Start time (d/f to adjust)">
        <input type="number" />
      </Tooltip>
    );
    const input = screen.getByRole('spinbutton');
    fireEvent.focus(input);
    settle();
    expect(screen.queryByRole('tooltip')).toBeNull();

    // Hover still reveals it.
    hoverIn(input);
    settle();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('still shows on focus for a checkbox (focus is highlight, not typing)', () => {
    render(
      <Tooltip text="Vocals in Mono">
        <input type="checkbox" />
      </Tooltip>
    );
    fireEvent.focus(screen.getByRole('checkbox'));
    settle();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('hides while suppressed (hold-to-repeat gesture)', () => {
    const { rerender } = render(
      <Tooltip text="Earlier" suppressed={false}>
        <button>earlier</button>
      </Tooltip>
    );
    hoverIn(screen.getByRole('button'));
    settle();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    rerender(
      <Tooltip text="Earlier" suppressed={true}>
        <button>earlier</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('forwards a ref the caller put on the child', () => {
    const ref = { current: null };
    render(
      <Tooltip text="Master">
        <button ref={ref}>master</button>
      </Tooltip>
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
