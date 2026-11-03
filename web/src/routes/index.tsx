import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import '../styles.css'

export const Route = createFileRoute('/')({
  component: Home,
})

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type HomeData = {
  id: string
  name: string
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong')
  }

  return data as T
}

function money(cents: number) {
  return `₹${(cents / 100).toFixed(2)}`
}

function Home() {
  const [home, setHome] = useState<HomeData | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')

  const [loading, setLoading] = useState(false)
  const [payingShare, setPayingShare] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refreshData = useCallback(async (homeId: string) => {
    const [memberData, billData, balanceData] = await Promise.all([
      api<{ members: Member[] }>(`/homes/${homeId}/members`),
      api<{ bills: Bill[] }>(`/homes/${homeId}/bills`),
      api<{ balances: Balance[] }>(`/homes/${homeId}/balances`),
    ])

    setMembers(memberData.members)
    setBills(billData.bills)
    setBalances(balanceData.balances)
  }, [])

  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const data = await api<HomeData>('/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName }),
      })

      setHome(data)
      setHomeName('')
      setMessage('Home created successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create home')
    } finally {
      setLoading(false)
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      await api(`/homes/${home.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName }),
      })

      setMemberName('')
      await refreshData(home.id)
      setMessage('Member added successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add member')
    } finally {
      setLoading(false)
    }
  }

  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const amount = Math.round(Number(billAmount) * 100)

      await api(`/homes/${home.id}/bills`, {
        method: 'POST',
        body: JSON.stringify({
          title: billTitle,
          totalCents: amount,
        }),
      })

      setBillTitle('')
      setBillAmount('')
      await refreshData(home.id)
      setMessage('Bill created successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create bill')
    } finally {
      setLoading(false)
    }
  }

  async function payShare(billId: string, shareId: string) {
    if (!home || payingShare) return

    setPayingShare(shareId)
    setError('')
    setMessage('')

    try {
      await api(`/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      await refreshData(home.id)
      setMessage('Payment recorded successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
      try {
        await refreshData(home.id)
      } catch {
        // Keep the existing screen visible if refresh also fails.
      }
    } finally {
      setPayingShare(null)
    }
  }

  useEffect(() => {
    if (!home) return

    refreshData(home.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Unable to load data')
    })
  }, [home, refreshData])

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>SplitMate</h1>
          <p>Manage shared expenses without the confusion.</p>
        </div>
        <span className="tag">Shared Bill Splitter</span>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {!home ? (
        <section className="panel">
          <h2>Create your home</h2>
          <p className="muted">Start by creating a shared home for your group.</p>
          <form onSubmit={createHome} className="form">
            <input
              value={homeName}
              onChange={(e) => setHomeName(e.target.value)}
              placeholder="Enter home name"
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create home'}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="welcome">
            <div>
              <span className="muted">YOUR HOME</span>
              <h2>{home.name}</h2>
              <p>
                {members.length} members · {bills.length} bills
              </p>
            </div>
            <button type="button" className="secondary" onClick={() => refreshData(home.id)}>
              Refresh
            </button>
          </section>

          <section className="grid">
            <div className="panel">
              <h3>Add a member</h3>
              <form onSubmit={addMember} className="form">
                <input
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Member name"
                  required
                />
                <button type="submit" disabled={loading}>
                  Add member
                </button>
              </form>
              <div className="member-list">
                {members.map((member) => (
                  <div className="member" key={member.id}>
                    <span className="avatar">{member.name[0]?.toUpperCase()}</span>
                    {member.name}
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="muted">No members yet. Add your first member.</p>
                )}
              </div>
            </div>

            <div className="panel">
              <h3>Create a bill</h3>
              <form onSubmit={createBill} className="form">
                <input
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  placeholder="Bill title"
                  required
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                  placeholder="Total amount (₹)"
                  required
                />
                <button type="submit" disabled={loading || members.length === 0}>
                  Create bill
                </button>
                {members.length === 0 && (
                  <p className="muted">Add members before creating a bill.</p>
                )}
              </form>
            </div>
          </section>

          <section className="panel">
            <h3>Outstanding balances</h3>
            {balances.length === 0 ? (
              <p className="muted">No balances to show yet.</p>
            ) : (
              <div className="balance-list">
                {balances.map((balance) => (
                  <div className="balance" key={balance.memberId}>
                    <span>{balance.name}</span>
                    <strong>{money(balance.outstandingCents)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h3>All bills</h3>
            {bills.length === 0 ? (
              <p className="muted">No bills yet. Create your first bill.</p>
            ) : (
              <div className="bill-list">
                {bills.map((bill) => (
                  <article className="bill" key={bill.id}>
                    <div className="bill-heading">
                      <div>
                        <h4>{bill.title}</h4>
                        <span className="muted">Total: {money(bill.totalCents)}</span>
                      </div>
                    </div>

                    <div className="share-list">
                      {bill.shares.map((share) => {
                        const member = members.find((item) => item.id === share.memberId)

                        return (
                          <div className="share" key={share.id}>
                            <div>
                              <strong>{member?.name || 'Member'}</strong>
                              <p className="muted">{money(share.amountCents)}</p>
                            </div>
                            {share.paidAt ? (
                              <span className="paid">Paid</span>
                            ) : (
                              <button
                                type="button"
                                className="pay-button"
                                disabled={payingShare !== null}
                                onClick={() => payShare(bill.id, share.id)}
                              >
                                {payingShare === share.id ? 'Paying...' : 'Mark paid'}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
