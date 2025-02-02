const bcrypt = require('bcryptjs')
const { User, Tweet, Reply, Followship, Like } = require('../models')
const { Op } = require('sequelize')
const jwt = require('jsonwebtoken')
const helpers = require('../_helpers')
const { imgurFileHandler } = require('../helpers/file-helpers')
const { relativeTimeFromNow } = require('../helpers/dayjs-helpers')

const userController = {
  signUp: (req, res, next) => {
    const { account, name, email, password, checkPassword } = req.body

    if (password !== checkPassword) {
      const err = new Error("Password don't match")
      err.status = 403
      throw err
    }

    User.findOne({
      where: { [Op.or]: [{ email }, { account }] }
    })
      .then(user => {
        if (user) throw new Error('Email or Account already exists!')

        return bcrypt.hash(req.body.password, 10)
      })
      .then(hash => User.create({
        account,
        name,
        email,
        password: hash,
        role: 'user',
        avatar: 'https://i.imgur.com/05zPOOl.png',
        cover: 'https://i.imgur.com/Obnf9Ky.png',
        createdAt: new Date(),
        updatedAt: new Date()
      }))
      .then(user => {
        const userData = user.toJSON()
        delete userData.password
        return res.status(200).json({ status: 'success', user: userData })
      })
      .catch(err => next(err))
  },
  signIn: async (req, res, next) => {
    try {
      const { account, password } = req.body
      const user = await User.findOne({ where: { account } })

      if (!user) throw new Error('帳號不存在')
      if (user.role !== 'user') throw new Error("User doesn't exist.")
      if (!bcrypt.compareSync(password, user.password)) throw new Error('密碼不正確')

      const userData = user.toJSON()
      delete userData.password

      const token = jwt.sign(userData, process.env.JWT_SECRET, { expiresIn: '30d' })

      return res.status(200).json({
        status: 'success',
        data: {
          token,
          user: userData
        }
      })
    } catch (err) {
      next(err)
    }
  },
  getUser: async (req, res, next) => {
    try {
      const id = req.params.id
      const user = await User.findByPk(id)
      if (!user) throw new Error("User doesn't exist.")

      const userData = user.toJSON()
      delete userData.password
      return res.status(200).json({ status: 'success', ...userData })
    } catch (err) {
      next(err)
    }
  },
  editUser: async (req, res, next) => {
    try {
      const userId = Number(req.params.id)
      const currentUserId = helpers.getUser(req).id

      if (userId !== currentUserId) throw new Error('You have no permission to edit.')

      const { account = '', name = '', email = '', password = null, checkPassword = null, introduction = null } = req.body

      if (account || email) {
        const existUser = await User.findOne({
          where: { [Op.or]: [{ email }, { account }] }
        })

        if (existUser) throw new Error('此account/email已經註冊過')
      }

      if (name && name.length > 50) throw new Error("Name can't over 50 letter")

      if (password !== checkPassword) throw new Error("Password doesn't match.")

      const avatarLink = req.files?.avatar ? await imgurFileHandler(req.files.avatar[0]) : null
      const coverLink = req.files?.cover ? await imgurFileHandler(req.files.cover[0]) : null

      const user = await User.findByPk(userId)
      if (!user) {
        const err = new Error("User doesn't exist.")
        err.status(404)
        throw err
      }

      const userData = {
        account: account === '' ? user.dataValues.account : account,
        name: name === '' ? user.dataValues.name : name,
        email: email === '' ? user.dataValues.email : email,
        password: password ? bcrypt.hashSync(password, 10) : user.dataValues.password,
        introduction: introduction || user.dataValues.introduction,
        avatar: avatarLink || user.dataValues.avatar,
        cover: coverLink || user.dataValues.cover
      }

      await user.update({ ...userData })
      delete userData.password
      return res.status(200).json({ status: 'success', userData })
    } catch (err) {
      next(err)
    }
  },
  getUserTweets: async (req, res, next) => {
    try {
      const userId = req.params.id
      const currentUserId = helpers.getUser(req).id

      const user = await User.findByPk(userId, {
        raw: true,
        nest: true,
        attributes: { exclude: ['password'] }
      })

      if (!user) throw new Error("User doesn't exist.")

      const tweets = await Tweet.findAll({
        where: { userId },
        include: [
          { model: Reply },
          {
            model: User,
            as: 'LikedUsers',
            attributes: ['id']
          }
        ],
        order: [['createdAt', 'DESC']]
      })

      const tweetData = tweets.map(tweet => {
        return {
          ...tweet.toJSON(),
          createdAt: relativeTimeFromNow(tweet.createdAt),
          likedUsersCount: tweet.LikedUsers.length,
          repliesCount: tweet.Replies.length,
          isLiked: tweet.LikedUsers.some(liked => liked.id === currentUserId)
        }
      })

      return res.status(200).json(tweetData)
    } catch (err) {
      next(err)
    }
  },
  getUsersFollowings: async (req, res, next) => {
    try {
      const userId = req.params.id
      const currentUserId = helpers.getUser(req).id

      const user = await User.findByPk(userId, {
        include: [
          { model: User, as: 'Followings' }
        ]
      })

      const currenUserFolloings = await Followship.findAll({
        where: { followerId: currentUserId },
        nest: true,
        raw: true
      })

      const userfollowings = user.toJSON().Followings.map(followingUser => {
        return {
          followingId: followingUser.id,
          account: followingUser.account,
          name: followingUser.name,
          email: followingUser.email,
          avatar: followingUser.avatar,
          introduction: followingUser.introduction,
          isFollowed: currenUserFolloings.some(f => f.followingId === followingUser.id)
        }
      })

      return res.status(200).json(userfollowings)
    } catch (err) {
      next(err)
    }
  },
  getUsersFollowers: async (req, res, next) => {
    try {
      const userId = req.params.id
      const currentUserId = helpers.getUser(req).id

      const user = await User.findByPk(userId, {
        include: [
          { model: User, as: 'Followers' }
        ]
      })

      const currenUserFolloings = await Followship.findAll({
        where: { followerId: currentUserId },
        nest: true,
        raw: true
      })

      const userfollowers = user.toJSON().Followers.map(followerUser => {
        return {
          followerId: followerUser.id,
          account: followerUser.account,
          name: followerUser.name,
          email: followerUser.email,
          avatar: followerUser.avatar,
          introduction: followerUser.introduction,
          isFollowed: currenUserFolloings.some(f => f.followingId === followerUser.id)
        }
      })

      return res.status(200).json(userfollowers)
    } catch (err) {
      next(err)
    }
  },
  getUserTop10: async (req, res, next) => {
    try {
      const currentUserId = helpers.getUser(req).id
      console.log('currentUserId: ', currentUserId)

      const users = await User.findAll({
        include: [
          {
            model: User,
            as: 'Followers'
          }
        ],
        where: {
          id: { [Op.not]: [currentUserId] },
          role: 'user'
        }
      })

      if (!users) {
        const err = new Error('No users exist.')
        err.status = 404
        throw err
      }

      const data = users.map(user => {
        return {
          id: user.id,
          account: user.account,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          cover: user.cover,
          followerCount: user.Followers.length,
          isFollowed: user.Followers.some(follower => follower.id === currentUserId)
        }
      })
        .sort((a, b) => b.followerCount - a.followerCount)
        .slice(0, 10)

      // TODO
      // try another way
      // const users = await User.findAll({
      //   attributes: [
      //     'id',
      //     [fn('COUNT', col('User.id')), 'followingCount'],
      //     'eamil',
      //     'account',
      //     'avatar',
      //     'cover'
      //   ],
      //   include: [
      //     {
      //       model: User,
      //       as: 'Followers',
      //       required: false,
      //       attributes: []
      //     }
      //   ],
      //   where: {
      //     id: { [Op.not]: [currentUserId] },
      //     role: 'user'
      //   },
      //   group: ['User.id'],
      //   nest: true,
      //   raw: true
      // })

      return res.status(200).json({
        status: 'success',
        data
      })
    } catch (err) {
      next(err)
    }
  },
  getUserLikes: async (req, res, next) => {
    try {
      const userId = req.params.id
      const currentUserId = helpers.getUser(req).id

      const user = await User.findByPk(userId)

      if (!user || user.role === 'adimn') {
        const err = new Error("User doesn't exist.")
        err.status = 404
        throw err
      }

      const likes = await Like.findAll({
        where: { UserId: userId },
        include: [
          {
            model: Tweet,
            include: [
              { model: User },
              Reply,
              Like
            ]
          }
        ],
        order: [['createdAt', 'DESC']]
      })

      const myLikes = await Like.findAll({
        where: { UserId: currentUserId },
        raw: true
      })

      if (!likes.length) {
        return res.status(200).json({
          message: 'There has no likes.'
        })
      }

      const currentUserLikes = myLikes.map(like => like.TweetId) || []
      const data = likes.map(like => {
        return {
          ...like.toJSON(),
          createdAt: relativeTimeFromNow(like.createdAt),
          tweetCreatedAt: relativeTimeFromNow(like.Tweet.createdAt),
          repliesCount: like.Tweet.Replies.length || 0,
          likedCount: like.Tweet.Likes.length || 0,
          isLiked: currentUserLikes?.includes(like.Tweet.id)
        }
      })

      return res.status(200).json(data)
    } catch (err) {
      next(err)
    }
  },
  gerUserReplies: async (req, res, next) => {
    try {
      const userId = req.params.id
      const user = User.findByPk(userId)

      if (!user || user.role === 'admin') {
        const err = new Error("User doesn't exist.")
        err.status = 404
        throw err
      }

      const replies = await Reply.findAll({
        where: { UserId: userId },
        include: [
          { model: User },
          {
            model: Tweet,
            include: [
              { model: User }
            ]
          }
        ],
        order: [['createdAt', 'DESC']]
      })

      if (!replies.length) {
        return res.status(200).json({
          message: 'There has not replies.'
        })
      }

      const data = replies.map(reply => {
        return {
          ...reply.toJSON(),
          createdAt: relativeTimeFromNow(reply.createdAt)
        }
      })

      return res.status(200).json(data)
    } catch (err) {
      next(err)
    }
  }
}

module.exports = userController
