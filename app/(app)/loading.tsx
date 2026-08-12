import { Skeleton } from "@/components/ui/primitives";

/**
 * Route-level loading state.
 *
 * The skeleton mirrors the real layout — masthead, index rail, two-column body
 * — rather than being a generic spinner, so the page does not visibly rearrange
 * when the data lands. Matching the eventual geometry is what makes a loading
 * state feel like the page arriving instead of being replaced.
 */
export default function Loading() {
  return (
    <div>
      <div className="border-b border-line px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="mt-4 h-8 w-[280px]" />
        <Skeleton className="mt-3.5 h-3 w-[min(560px,80%)]" />
        <div className="mt-5 flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>

      <div className="space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-3 bg-ink-900 p-3.5">
              <Skeleton className="h-2 w-20" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_356px]">
          <div className="space-y-5">
            <div className="panel h-[210px] p-5">
              <Skeleton className="h-2.5 w-32" />
              <div className="mt-6 grid gap-8 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-1.5 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ))}
              </div>
            </div>
            <div className="panel h-[380px] p-5">
              <Skeleton className="h-2.5 w-28" />
              <div className="mt-6 space-y-3.5">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-4 w-full" style={{ opacity: 1 - i * 0.08 }} />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="panel h-[240px] p-5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mx-auto mt-6 h-[168px] w-[168px] rounded-full" />
            </div>
            <div className="panel h-[150px] p-5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-5 h-7 w-28" />
              <Skeleton className="mt-4 h-3 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
