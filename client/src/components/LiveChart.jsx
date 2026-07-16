import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    const val = payload[0].value
    const mbps = typeof val === 'number' ? val : parseFloat(val)
    const mbytes = mbps / 8
    return (
      <div className="chart-tooltip">
        <div className="tooltip-time">Time: {label}s</div>
        <div className="tooltip-row">
          <span style={{ color: '#00d4ff' }}>Bandwidth:&nbsp;</span>
          <strong>{mbps.toFixed(2)} Mbps</strong>
        </div>
        <div className="tooltip-row" style={{ marginTop: 4 }}>
          <span style={{ color: '#00e887' }}>&nbsp;</span>
          <strong style={{ color: '#00e887' }}>({mbytes.toFixed(2)} MB/s)</strong>
        </div>
      </div>
    )
  }
  return null
}

export default function LiveChart({ data, isRunning }) {
  const hasData = data && data.length > 0
  const avgBw   = hasData
    ? (data.reduce((s, d) => s + d.bandwidth_mbps, 0) / data.length).toFixed(1)
    : null

  // Align left and right Y-axes by rounding max bandwidth to a multiple of 8
  const maxBw = hasData ? Math.max(...data.map(d => d.bandwidth_mbps), 8) : 80
  const roundMaxMbps = Math.ceil(maxBw / 8) * 8
  const roundMaxMBytes = roundMaxMbps / 8

  return (
    <div className={`chart-wrapper ${isRunning ? 'running' : ''}`}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00d4ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#00d4ff" stopOpacity={0}   />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />

          <XAxis
            dataKey="interval_end"
            stroke="#3d4a66"
            tick={{ fill: '#6b7a99', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#1e2a44' }}
            label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -8, fill: '#3d4a66', fontSize: 11 }}
          />

          {/* Left Y-Axis: Mbps */}
          <YAxis
            yAxisId="left"
            domain={[0, roundMaxMbps]}
            stroke="#3d4a66"
            tick={{ fill: '#6b7a99', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={58}
            label={{ value: 'Mbps', angle: -90, position: 'insideLeft', offset: 10, fill: '#3d4a66', fontSize: 11 }}
          />

          {/* Right Y-Axis: MB/s */}
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, roundMaxMBytes]}
            stroke="#3d4a66"
            tick={{ fill: '#6b7a99', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={50}
            label={{ value: 'MB/s', angle: 90, position: 'insideRight', offset: 10, fill: '#3d4a66', fontSize: 11 }}
          />

          <Tooltip content={<CustomTooltip />} />

          {avgBw && (
            <ReferenceLine
              yAxisId="left"
              y={parseFloat(avgBw)}
              stroke="rgba(0,212,255,0.35)"
              strokeDasharray="4 4"
              label={{ value: `avg ${avgBw}`, fill: 'rgba(0,212,255,0.6)', fontSize: 10, position: 'right' }}
            />
          )}

          <Area
            yAxisId="left"
            type="monotone"
            dataKey="bandwidth_mbps"
            name="Bandwidth"
            stroke="#00d4ff"
            strokeWidth={2}
            fill="url(#bwGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#00d4ff', stroke: '#080c18', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
