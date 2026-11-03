CREATE TABLE homes (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_homes PRIMARY KEY (id),
  CONSTRAINT ck_homes_name CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_members PRIMARY KEY (id),
  CONSTRAINT fk_members_home
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT uq_members_home_position UNIQUE (home_id, position)
);

CREATE TABLE bills (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_bills PRIMARY KEY (id),
  CONSTRAINT fk_bills_home
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT ck_bills_total_positive CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT pk_shares PRIMARY KEY (id),
  CONSTRAINT fk_shares_bill
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_member
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT ck_shares_amount_nonnegative CHECK (amount_cents >= 0),
  CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id)
);

CREATE INDEX idx_members_home ON members(home_id, position);
CREATE INDEX idx_bills_home ON bills(home_id);
CREATE INDEX idx_shares_bill ON shares(bill_id);
CREATE INDEX idx_shares_member ON shares(member_id);