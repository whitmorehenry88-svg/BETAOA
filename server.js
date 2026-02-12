const express = require("express");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Session configuration
app.use(
  session({
    secret: "workhome-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // set to true if using https
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// In-memory database (para produção, use MongoDB, PostgreSQL, etc.)
const users = new Map();
const transactions = new Map();
const bets = new Map();

// Helper function to generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Não autenticado" });
  }
}

// Routes

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validate input
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Todos os campos são obrigatórios",
      });
    }

    // Check if user already exists
    const existingUser = Array.from(users.values()).find(
      (u) => u.email === email || u.phone === phone
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email ou telefone já cadastrado",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = generateId();
    const user = {
      id: userId,
      name,
      email,
      phone,
      password: hashedPassword,
      balance: 100000, // Bónus de boas-vindas em Kwanzas
      totalBet: 0,
      totalWon: 0,
      totalBets: 0,
      createdAt: new Date(),
      isActive: true,
    };

    users.set(userId, user);

    // Create session
    req.session.userId = userId;

    // Return user data (without password)
    const { password: _, ...userData } = user;

    res.json({
      success: true,
      message: "Conta criada com sucesso!",
      user: userData,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao criar conta",
    });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email e senha são obrigatórios",
      });
    }

    // Find user by email or phone
    const user = Array.from(users.values()).find(
      (u) => u.email === email || u.phone === email
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Credenciais inválidas",
      });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Credenciais inválidas",
      });
    }

    // Create session
    req.session.userId = user.id;

    // Return user data (without password)
    const { password: _, ...userData } = user;

    res.json({
      success: true,
      message: "Login realizado com sucesso!",
      user: userData,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao fazer login",
    });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Erro ao fazer logout",
      });
    }
    res.json({
      success: true,
      message: "Logout realizado com sucesso",
    });
  });
});

// Get current user
app.get("/api/auth/me", isAuthenticated, (req, res) => {
  const user = users.get(req.session.userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Utilizador não encontrado",
    });
  }

  const { password: _, ...userData } = user;
  res.json({
    success: true,
    user: userData,
  });
});

// Get user balance
app.get("/api/user/balance", isAuthenticated, (req, res) => {
  const user = users.get(req.session.userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "Utilizador não encontrado",
    });
  }

  res.json({
    success: true,
    balance: user.balance,
    totalBet: user.totalBet,
    totalWon: user.totalWon,
    totalBets: user.totalBets,
  });
});

// Place bet
app.post("/api/bets/place", isAuthenticated, (req, res) => {
  try {
    const { game, betAmount, gameData } = req.body;
    const user = users.get(req.session.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilizador não encontrado",
      });
    }

    // Validate bet amount
    if (betAmount < 100) {
      return res.status(400).json({
        success: false,
        message: "Valor mínimo de aposta: 100 Kz",
      });
    }

    if (betAmount > user.balance) {
      return res.status(400).json({
        success: false,
        message: "Saldo insuficiente",
      });
    }

    // Process bet based on game type
    let result = {};

    switch (game) {
      case "numbers":
        result = processNumbersGame(betAmount, gameData);
        break;
      case "slots":
        result = processSlotsGame(betAmount);
        break;
      case "wheel":
        result = processWheelGame(betAmount);
        break;
      case "coin":
        result = processCoinGame(betAmount, gameData);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Jogo inválido",
        });
    }

    // Update user balance
    user.balance -= betAmount;
    user.totalBet += betAmount;
    user.totalBets++;

    if (result.won) {
      user.balance += result.prize;
      user.totalWon += result.prize;
    }

    // Save bet record
    const betId = generateId();
    const betRecord = {
      id: betId,
      userId: user.id,
      game,
      betAmount,
      result: result.won ? result.prize : -betAmount,
      won: result.won,
      gameData,
      resultData: result,
      timestamp: new Date(),
    };
    bets.set(betId, betRecord);

    res.json({
      success: true,
      result: result,
      balance: user.balance,
      totalBet: user.totalBet,
      totalWon: user.totalWon,
      totalBets: user.totalBets,
    });
  } catch (error) {
    console.error("Bet error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar aposta",
    });
  }
});

// Game logic functions
function processNumbersGame(betAmount, gameData) {
  const selectedNumber = gameData.selectedNumber;
  const winningNumber = Math.floor(Math.random() * 25) + 1;
  const won = winningNumber === selectedNumber;
  const prize = won ? betAmount * 24 : 0;

  return {
    won,
    prize,
    winningNumber,
    selectedNumber,
  };
}

function processSlotsGame(betAmount) {
  const symbols = ["🍒", "🍋", "🍊", "🍇", "💎", "⭐", "7️⃣"];
  const result1 = symbols[Math.floor(Math.random() * symbols.length)];
  const result2 = symbols[Math.floor(Math.random() * symbols.length)];
  const result3 = symbols[Math.floor(Math.random() * symbols.length)];

  const won = result1 === result2 && result2 === result3;
  const prize = won ? betAmount * 10 : 0;

  return {
    won,
    prize,
    symbols: [result1, result2, result3],
  };
}

function processWheelGame(betAmount) {
  const prizes = [2, 0, 1.5, 0, 3, 0, 5, 0];
  const prizeIndex = Math.floor(Math.random() * prizes.length);
  const multiplier = prizes[prizeIndex];
  const won = multiplier > 0;
  const prize = betAmount * multiplier;

  return {
    won,
    prize,
    multiplier,
    segment: prizeIndex,
  };
}

function processCoinGame(betAmount, gameData) {
  const choice = gameData.choice; // 'heads' or 'tails'
  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = choice === result;
  const prize = won ? betAmount * 2 : 0;

  return {
    won,
    prize,
    result,
    choice,
  };
}

// Deposit
app.post("/api/transactions/deposit", isAuthenticated, (req, res) => {
  try {
    const { amount } = req.body;
    const user = users.get(req.session.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilizador não encontrado",
      });
    }

    if (amount < 1000) {
      return res.status(400).json({
        success: false,
        message: "Valor mínimo de depósito: 1.000 Kz",
      });
    }

    // Update balance
    user.balance += amount;

    // Save transaction
    const transactionId = generateId();
    const transaction = {
      id: transactionId,
      userId: user.id,
      type: "deposit",
      amount,
      status: "completed",
      timestamp: new Date(),
    };
    transactions.set(transactionId, transaction);

    res.json({
      success: true,
      message: "Depósito confirmado!",
      balance: user.balance,
      transaction,
    });
  } catch (error) {
    console.error("Deposit error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar depósito",
    });
  }
});

// Withdraw
app.post("/api/transactions/withdraw", isAuthenticated, (req, res) => {
  try {
    const { amount, iban, accountName } = req.body;
    const user = users.get(req.session.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilizador não encontrado",
      });
    }

    if (amount < 1000) {
      return res.status(400).json({
        success: false,
        message: "Valor mínimo de levantamento: 1.000 Kz",
      });
    }

    if (amount > user.balance) {
      return res.status(400).json({
        success: false,
        message: "Saldo insuficiente",
      });
    }

    if (!iban || !accountName) {
      return res.status(400).json({
        success: false,
        message: "IBAN e nome do titular são obrigatórios",
      });
    }

    // Update balance
    user.balance -= amount;

    // Save transaction
    const transactionId = generateId();
    const transaction = {
      id: transactionId,
      userId: user.id,
      type: "withdraw",
      amount,
      iban,
      accountName,
      status: "pending",
      timestamp: new Date(),
    };
    transactions.set(transactionId, transaction);

    res.json({
      success: true,
      message: "Pedido de levantamento enviado!",
      balance: user.balance,
      transaction,
    });
  } catch (error) {
    console.error("Withdraw error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar levantamento",
    });
  }
});

// Get bet history
app.get("/api/bets/history", isAuthenticated, (req, res) => {
  try {
    const userId = req.session.userId;
    const userBets = Array.from(bets.values())
      .filter((bet) => bet.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50); // Last 50 bets

    res.json({
      success: true,
      bets: userBets,
    });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao carregar histórico",
    });
  }
});

// Get transaction history
app.get("/api/transactions/history", isAuthenticated, (req, res) => {
  try {
    const userId = req.session.userId;
    const userTransactions = Array.from(transactions.values())
      .filter((transaction) => transaction.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      transactions: userTransactions,
    });
  } catch (error) {
    console.error("Transaction history error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao carregar histórico de transações",
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "WorkHome API está online",
    timestamp: new Date(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint não encontrado",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    message: "Erro interno do servidor",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
    ╔══════════════════════════════════════════╗
    ║                                          ║
    ║          🎰 WORKHOME SERVER 🎰          ║
    ║                                          ║
    ║  Servidor rodando em:                    ║
    ║  http://localhost:${PORT}                     ║
    ║                                          ║
    ║  Ambiente: ${process.env.NODE_ENV || "development"}                    ║
    ║  Porta: ${PORT}                               ║
    ║                                          ║
    ╚══════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM recebido, encerrando servidor...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nSIGINT recebido, encerrando servidor...");
  process.exit(0);
});
