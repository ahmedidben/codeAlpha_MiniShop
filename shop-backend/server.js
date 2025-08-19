const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

// === MySQL connection (simple single connection for learning) ===
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "root",      // <- change if needed
  database: "shopdb"
});
db.connect((err) => {
  if (err) throw err;
  console.log('✅ Connected to MySQL');
});

// === Middleware ===
// If you open frontend from a file server like VSCode Live Server -> 5500
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax' // OK for localhost
  }
}));

// Serve the test frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// === Helpers ===
function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function ensureCart(req) {
  if (!req.session.cart) req.session.cart = []; // [{productId, qty}]
  return req.session.cart;
}

// === Routes ===
app.get('/', (req, res) => res.send('Welcome to e-commerce API!'));

// Auth status
app.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, username: req.session.username, email: req.session.email } });
});

// Products
app.get('/products', (req, res) => {
  db.query('SELECT * FROM products', (err, results) => {
    if (err) {
      console.error('Error loading products:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

app.get('/products/:id', (req, res) => {
  db.query('SELECT * FROM products WHERE id = ?', [req.params.id], (err, results) => {
    if (err) {
      console.error('Error loading product:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!results.length) return res.status(404).json({ error: 'Product not found' });
    res.json(results[0]);
  });
});

// Register
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });

  db.query('SELECT 1 FROM users WHERE email = ?', [email], async (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (rows.length) return res.status(400).json({ error: 'User already exists' });

    const hash = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (username, email, password) VALUES (?,?,?)',
      [username, email, hash],
      (err2, result) => {
        if (err2) return res.status(500).json({ error: 'Database error' });
        res.status(201).json({ message: 'User registered successfully' });
      }
    );
  });
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.email = user.email;
    res.json({ message: 'Login successful', user: { id: user.id, username: user.username, email: user.email } });
  });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

// === Cart (session-based) ===
// Get cart
app.get('/cart', (req, res) => {
  const cart = ensureCart(req);
  res.json(cart);
});

// Add to cart
app.post('/cart/add', (req, res) => {
  const { productId, qty } = req.body || {};
  const q = parseInt(qty || 1, 10);
  if (!productId || q <= 0) return res.status(400).json({ error: 'Invalid payload' });

  const cart = ensureCart(req);
  const existing = cart.find(i => i.productId === Number(productId));
  if (existing) existing.qty += q;
  else cart.push({ productId: Number(productId), qty: q });

  res.json({ message: 'Added to cart', cart });
});

// Update item qty
app.post('/cart/update', (req, res) => {
  const { productId, qty } = req.body || {};
  const q = parseInt(qty, 10);
  if (!productId || isNaN(q) || q < 0) return res.status(400).json({ error: 'Invalid payload' });

  const cart = ensureCart(req);
  const idx = cart.findIndex(i => i.productId === Number(productId));
  if (idx === -1) return res.status(404).json({ error: 'Item not in cart' });

  if (q === 0) cart.splice(idx, 1);
  else cart[idx].qty = q;

  res.json({ message: 'Cart updated', cart });
});

// Clear cart
app.delete('/cart/clear', (req, res) => {
  req.session.cart = [];
  res.json({ message: 'Cart cleared' });
});

// Compute cart with product data + total
app.get('/cart/detail', (req, res) => {
  const cart = ensureCart(req);
  if (!cart.length) return res.json({ items: [], total: 0 });

  const ids = cart.map(i => i.productId);
  db.query(`SELECT id, name, price FROM products WHERE id IN (${ids.map(()=>'?').join(',')})`, ids, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const map = Object.fromEntries(rows.map(p => [p.id, p]));

    let total = 0;
    const items = cart.map(i => {
      const p = map[i.productId];
      const line = p ? Number(p.price) * i.qty : 0;
      total += line;
      return { productId: i.productId, name: p?.name, price: p?.price, qty: i.qty, lineTotal: line };
    });
    res.json({ items, total: Number(total.toFixed(2)) });
  });
});

// === Orders ===
// Create order from session cart (requires login)
app.post('/orders', auth, (req, res) => {
  const cart = ensureCart(req);
  if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

  const ids = cart.map(i => i.productId);
  db.query(`SELECT id, price, stock FROM products WHERE id IN (${ids.map(()=>'?').join(',')})`, ids, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (rows.length !== ids.length) return res.status(400).json({ error: 'One or more products not found' });

    // Check stock + compute total
    const info = Object.fromEntries(rows.map(p => [p.id, p]));
    let total = 0;
    for (const item of cart) {
      const p = info[item.productId];
      if (item.qty > p.stock) return res.status(400).json({ error: `Insufficient stock for product ${item.productId}` });
      total += Number(p.price) * item.qty;
    }

    // Begin simple "transaction"
    db.beginTransaction(txErr => {
      if (txErr) return res.status(500).json({ error: 'Failed to start transaction' });

      // Insert order
      db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [req.session.userId, total.toFixed(2)], (oErr, oRes) => {
        if (oErr) {
          return db.rollback(() => res.status(500).json({ error: 'Failed to create order' }));
        }
        const orderId = oRes.insertId;

        // Insert items + decrement stock
        const values = cart.map(i => [orderId, i.productId, i.qty, info[i.productId].price]);
        db.query('INSERT INTO order_items (order_id, product_id, qty, price) VALUES ?', [values], (iErr) => {
          if (iErr) {
            return db.rollback(() => res.status(500).json({ error: 'Failed to add order items' }));
          }

          // Update stock
          const stockUpdates = cart.map(i => {
            return new Promise((resolve, reject) => {
              db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [i.qty, i.productId], (uErr) => {
                if (uErr) reject(uErr); else resolve();
              });
            });
          });

          Promise.all(stockUpdates).then(() => {
            db.commit(cErr => {
              if (cErr) {
                return db.rollback(() => res.status(500).json({ error: 'Commit failed' }));
              }
              // Clear cart after order
              req.session.cart = [];
              res.status(201).json({ message: 'Order placed', orderId, total: Number(total.toFixed(2)) });
            });
          }).catch(e => {
            db.rollback(() => res.status(500).json({ error: 'Stock update failed' }));
          });
        });
      });
    });
  });
});

// My orders
app.get('/orders', auth, (req, res) => {
  db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Order details
app.get('/orders/:id', auth, (req, res) => {
  const orderId = req.params.id;
  db.query('SELECT * FROM orders WHERE id = ? AND user_id = ?', [orderId, req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    db.query(
      `SELECT oi.product_id, p.name, oi.qty, oi.price, (oi.qty * oi.price) AS lineTotal
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      [orderId],
      (e2, items) => {
        if (e2) return res.status(500).json({ error: 'Database error' });
        res.json({ order: rows[0], items });
      }
    );
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 API running at http://localhost:${port}`);
});
