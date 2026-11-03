import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()
type Member = {
  id: string
  homeId: string
  name: string
}
// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// 1. Create a home
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)

  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Valid home name is required' }, 422)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// 2. Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Valid member name is required' }, 422)
  }

  const position = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), 0) + 1 AS nextPosition FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ nextPosition: number }>()

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, position?.nextPosition ?? 1)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// 2a. Get members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(`
      SELECT id, home_id AS homeId, name
      FROM members
      WHERE home_id = ?
      ORDER BY position ASC
    `)
    .bind(homeId)
    .all<Member>()

  return c.json({ members: members.results })
})

// 3. Create a bill and split it between members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req
    .json<{
      title?: unknown
      totalCents?: unknown
    }>()
    .catch(() => null)

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  if (
    !body ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    typeof body.totalCents !== 'number' ||
    !Number.isSafeInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'Invalid bill details or amount' }, 422)
  }

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const title = body.title.trim()
  const totalCents = body.totalCents
  const billId = crypto.randomUUID()

  const baseAmount = Math.floor(totalCents / members.results.length)
  const extraCents = totalCents % members.results.length

  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (index < extraCents ? 1 : 0),
    paidAt: null,
  }))

  // Insert bill and all shares in one D1 batch.
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),

    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      )
        .bind()
        .bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// 4. Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')

  if (!key?.trim()) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents,
            paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  const paidAt = new Date().toISOString()

  // Atomic conditional update prevents double payment.
  const result = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  const updatedShare = await c.env.DB.prepare(
    `SELECT id, member_id AS memberId, amount_cents AS amountCents,
            paid_at AS paidAt, idempotency_key AS idempotencyKey
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{
      id: string
      memberId: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!updatedShare) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (result.meta.changes === 0) {
    if (updatedShare.idempotencyKey !== key) {
      return c.json({ error: 'Share has already been paid' }, 409)
    }
  }

  return c.json(
    {
      id: updatedShare.id,
      memberId: updatedShare.memberId,
      amountCents: updatedShare.amountCents,
      paidAt: updatedShare.paidAt,
    },
    200,
  )
})

// 5. Get outstanding balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(
         SUM(
           CASE WHEN s.paid_at IS NULL
             THEN s.amount_cents
             ELSE 0
           END
         ), 0
       ) AS outstandingCents
     FROM members m
     LEFT JOIN bills b ON b.home_id = m.home_id
     LEFT JOIN shares s ON s.bill_id = b.id AND s.member_id = m.id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.position
     ORDER BY m.position ASC`,
  )
    .bind(homeId)
    .all()

  return c.json({ balances: result.results }, 200)
})

// 6. Get all bills for a home, including shares
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, title,
            total_cents AS totalCents
     FROM bills
     WHERE home_id = ?
     ORDER BY created_at ASC, rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      homeId: string
      title: string
      totalCents: number
    }>()

  const result = []

  for (const bill of bills.results) {
    const shares = await c.env.DB.prepare(
      `SELECT id, member_id AS memberId,
              amount_cents AS amountCents,
              paid_at AS paidAt
       FROM shares
       WHERE bill_id = ?`,
    )
      .bind(bill.id)
      .all()

    result.push({
      ...bill,
      shares: shares.results,
    })
  }

  return c.json({ bills: result }, 200)
})

export default app
